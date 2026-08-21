import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import {
  createSession,
  listSessionsForInterview,
  suggestQuestion,
} from "@/lib/coding/queries";
import { normalizeLanguages } from "@/lib/coding/languages";
import {
  canStartCodingRound,
  MAX_INSTRUCTIONS,
  MAX_QUESTION_TITLE,
  MAX_TIME_LIMIT_MINUTES,
  MIN_TIME_LIMIT_MINUTES,
} from "@/lib/coding/session";
import {
  buildCandidateUrl,
  isCodingTokenSigningConfigured,
  SIGNING_UNAVAILABLE_MESSAGE,
} from "@/lib/coding/token";

/**
 * GET /api/interviews/:id/coding-session
 *
 * Every coding round for this interview, plus the question the job's Written
 * Assessment configuration suggests for a new one. Readable by every role —
 * a Viewer may read an interview, and a coding round is part of one.
 *
 * The candidate URL is returned ONLY for a session that is still open. A dead
 * link in a copy-to-clipboard button is worse than no button.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();
    const supabase = await createClient();

    const { data: interview } = await supabase
      .from("interviews")
      .select("id, application_id, status, application:applications(job_id)")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    // Another organization's interview is reported as not found — never confirm
    // that someone else's id exists.
    if (!interview) return jsonError("Interview not found.", 404);

    const row = interview as unknown as {
      id: string;
      application_id: string;
      status: string;
      application: { job_id: string } | null;
    };

    const { sessions, failed, schemaOutOfDate } = await listSessionsForInterview({
      organizationId: membership.organization.id,
      interviewId: id,
    });

    if (failed) {
      return jsonError(
        schemaOutOfDate
          ? "Coding rounds need a database migration that hasn't been applied yet (0031)."
          : "Could not load the coding rounds.",
        schemaOutOfDate ? 503 : 400
      );
    }

    const suggestion = row.application?.job_id
      ? await suggestQuestion({
          organizationId: membership.organization.id,
          jobId: row.application.job_id,
        })
      : null;

    const origin = request.nextUrl.origin;

    const withUrls = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        candidate_url:
          session.status === "created" || session.status === "in_progress"
            ? await buildCandidateUrl({ sessionId: session.id, origin })
            : null,
      }))
    );

    return NextResponse.json({
      data: withUrls,
      suggestion,
      can_start: canStartCodingRound(row.status),
      signing_configured: isCodingTokenSigningConfigured(),
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/interviews/:id/coding-session — start a coding round.
 *
 * Owner/Admin/Recruiter, matching who may schedule the interview this hangs off.
 * A Viewer must never be able to make the product issue a link to a real
 * candidate, which is the same rule that governs screening calls.
 *
 * IDEMPOTENT BY DESIGN. An interview that already has an open round gets that
 * round back rather than a second one — see createSession() for why.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    /**
     * Checked BEFORE anything is written. Without a signing key no link can be
     * issued, and a session with no reachable link is a row that looks like a
     * working coding round and is not one.
     */
    if (!isCodingTokenSigningConfigured()) {
      return jsonError(SIGNING_UNAVAILABLE_MESSAGE, 503);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    const raw = (body ?? {}) as Record<string, unknown>;

    const supabase = await createClient();
    const { data: interview } = await supabase
      .from("interviews")
      .select("id, application_id, status")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!interview) return jsonError("Interview not found.", 404);

    const interviewRow = interview as unknown as {
      id: string;
      application_id: string;
      status: string;
    };

    const startable = canStartCodingRound(interviewRow.status);
    if (!startable.ok) return jsonError(startable.reason, 409);

    // --- the question -------------------------------------------------------
    const title = typeof raw.question_title === "string" ? raw.question_title.trim() : "";
    if (title.length === 0) return jsonError("Give the question a title.", 400);
    if (title.length > MAX_QUESTION_TITLE) {
      return jsonError(`The title must be ${MAX_QUESTION_TITLE} characters or fewer.`, 400);
    }

    const description =
      typeof raw.question_description === "string" ? raw.question_description.trim() : "";
    if (description.length === 0) {
      return jsonError("Write the question the candidate should answer.", 400);
    }

    let instructions: string | null = null;
    if (typeof raw.instructions === "string") {
      const trimmed = raw.instructions.trim();
      instructions = trimmed.length === 0 ? null : trimmed.slice(0, MAX_INSTRUCTIONS);
    }

    // --- the offer ----------------------------------------------------------
    const languages = normalizeLanguages(raw.languages);

    let timeLimitMinutes: number | null = null;
    if (raw.time_limit_minutes !== undefined && raw.time_limit_minutes !== null && raw.time_limit_minutes !== "") {
      const numeric = Number(raw.time_limit_minutes);
      if (!Number.isFinite(numeric)) {
        return jsonError("The time limit must be a number of minutes, or empty.", 400);
      }
      const rounded = Math.round(numeric);
      if (rounded < MIN_TIME_LIMIT_MINUTES || rounded > MAX_TIME_LIMIT_MINUTES) {
        return jsonError(
          `A time limit must be between ${MIN_TIME_LIMIT_MINUTES} and ${MAX_TIME_LIMIT_MINUTES} minutes, or empty.`,
          400
        );
      }
      timeLimitMinutes = rounded;
    }

    const result = await createSession({
      organizationId: membership.organization.id,
      interviewId: id,
      applicationId: interviewRow.application_id,
      createdBy: user.id,
      questionTitle: title,
      questionDescription: description,
      instructions,
      languages,
      timeLimitMinutes,
    });

    if (!result.ok) return jsonError(result.error, result.status);

    const candidateUrl = await buildCandidateUrl({
      sessionId: result.session.id,
      origin: request.nextUrl.origin,
    });

    if (!candidateUrl) {
      // Signing was configured a moment ago, so this is the origin failing —
      // reported rather than returning a session nobody can reach.
      return jsonError(
        "The coding round was created but its link could not be built. Set APP_URL and try again.",
        500
      );
    }

    // Module 14. Only for a genuinely new round: logging a reused one would put
    // a second "started" event in the timeline for one act.
    if (!result.reused) {
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "interview",
        entityId: id,
        eventType: "interview.coding_round_started",
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        metadata: {
          coding_session_id: result.session.id,
          question_title: result.session.question_title,
        },
      });
    }

    return NextResponse.json(
      {
        data: { ...result.session, candidate_url: candidateUrl },
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
