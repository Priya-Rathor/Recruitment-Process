import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, parsePagination } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { parseCandidatePayload } from "@/lib/candidates/validation";
import { filtersFromSearchParams } from "@/lib/candidates/filters";
import { CANDIDATE_COLUMNS, findDuplicateCandidates, listCandidates } from "@/lib/candidates/queries";
import { formatMatchedOn } from "@/lib/candidates/dedupe";
import type { Candidate } from "@/lib/types";
import { logActivity } from "@/lib/activity/log";

/**
 * GET /api/candidates — organization-scoped list.
 *
 * Filters come from query params and are validated server-side by
 * filtersFromSearchParams(). Viewable by every role, including Viewer.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const { searchParams } = request.nextUrl;
    const { page, perPage, from } = parsePagination(searchParams);

    const { candidates, total, failed } = await listCandidates({
      organizationId: membership.organization.id,
      filters: filtersFromSearchParams(searchParams),
      limit: perPage,
      offset: from,
    });

    if (failed) return jsonError("Could not load candidates.", 400);

    return NextResponse.json({
      data: candidates,
      pagination: { page, per_page: perPage, total },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/candidates — create. Owner/Admin/Recruiter (Viewer denied).
 *
 * Runs the duplicate check first (spec flow: "system checks for duplicates
 * before creating a new candidate record"). A suspected duplicate does NOT
 * block creation — the same person legitimately re-applies, and blocking would
 * strand a real candidate. Instead it is recorded in candidate_duplicates for a
 * human to confirm or dismiss, and returned so the UI can warn immediately.
 *
 * Pass `acknowledge_duplicates: true` to skip the warning round trip when the
 * recruiter has already seen and accepted it.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseCandidatePayload(body, "create");
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const acknowledged = Boolean((body as Record<string, unknown>)?.acknowledge_duplicates);

    const duplicates = await findDuplicateCandidates({
      organizationId: membership.organization.id,
      email: parsed.data.email,
      phone: parsed.data.phone,
    });

    // First pass: tell the recruiter before creating anything.
    if (duplicates.length > 0 && !acknowledged) {
      return NextResponse.json(
        {
          error: "This candidate may already exist.",
          code: "duplicate_suspected",
          duplicates: duplicates.map((match) => ({
            id: match.candidate.id,
            name: match.candidate.name ?? null,
            matched_on: match.matchedOn,
          })),
        },
        { status: 409 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("candidates")
      .insert({
        ...parsed.data,
        organization_id: membership.organization.id,
        source: parsed.data.source ?? "manual",
      })
      .select(CANDIDATE_COLUMNS)
      .single();

    if (error) {
      console.error("[api] candidate create failed:", error);
      return jsonError("Could not create the candidate.", 400);
    }

    const candidate = data as unknown as Candidate;

    // Record the suspected duplicates for review. Best-effort: failing to log a
    // duplicate must not undo a candidate the recruiter just created.
    if (duplicates.length > 0) {
      const { error: duplicateError } = await supabase.from("candidate_duplicates").insert(
        duplicates.map((match) => ({
          organization_id: membership.organization.id,
          candidate_id: candidate.id,
          duplicate_of_id: match.candidate.id,
          matched_on: formatMatchedOn(match.matchedOn),
        }))
      );
      if (duplicateError) {
        console.error("[api] recording duplicates failed:", duplicateError);
      }
    }

    // Module 14. Two events, because they answer different questions: "when did
    // this person enter our system?" and "did we know they might already be in
    // it?". The second is what a manager asks after a duplicate causes trouble.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "candidate",
      entityId: candidate.id,
      eventType: "candidate.created",
      actorId: membership.user_id,
      metadata: { name: candidate.name, source: candidate.source },
    });

    if (duplicates.length > 0) {
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "candidate",
        entityId: candidate.id,
        eventType: "candidate.duplicate_flagged",
        actorId: membership.user_id,
        metadata: {
          duplicate_count: duplicates.length,
          acknowledged,
          matched_on: duplicates.flatMap((match) => match.matchedOn).slice(0, 5),
        },
      });
    }

    return NextResponse.json(
      {
        data: candidate,
        duplicates: duplicates.map((match) => ({
          id: match.candidate.id,
          name: match.candidate.name ?? null,
          matched_on: match.matchedOn,
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
