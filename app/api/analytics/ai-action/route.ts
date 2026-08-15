import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { describePeriod, filtersFromParams, resolvePeriods } from "@/lib/analytics/filters";
import { buildReport } from "@/lib/analytics/report";
import { explainAnalytics } from "@/lib/ai/explainAnalytics";
import { getSlaConfig } from "@/lib/pipeline/queries";
import { resolveTimeZone } from "@/lib/time";
import { logAiCall } from "@/lib/activity/log";

export const maxDuration = 60;

/**
 * Short response cache.
 *
 * The cost chapter names this pattern for "Ask Analytics AI": a manager will
 * click it repeatedly while reading. Keyed on the caller, the filters AND the
 * question, so a genuine change produces a fresh answer while repeat clicks do
 * not.
 *
 * LIMITATION: in-process, so per-instance on serverless. Adequate as a guard at
 * this scale; the cost-tracking retrofit should replace it with a shared store.
 */
const CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map<string, { at: number; payload: unknown }>();

function readCache(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeCache(key: string, payload: unknown) {
  if (cache.size > 300) cache.clear();
  cache.set(key, { at: Date.now(), payload });
}

/**
 * POST /api/analytics/ai-action — "Ask Analytics AI".
 *
 * THE REPORT IS REBUILT SERVER-SIDE, with the caller's own filters and role
 * scoping, and only that object reaches the model. So a Recruiter's answer can
 * only describe their own work, and no caller can widen what the model sees by
 * posting figures of their own — the endpoint takes a question, never data.
 *
 * All four roles may ask (section 9 grants Recruiter "own scope" and Viewer
 * read-only), which is safe precisely because the scoping happens before the
 * model is involved.
 */
export async function POST(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine — the default is "explain this period".
    }

    const question = (body as { question?: unknown })?.question;
    const trimmedQuestion =
      typeof question === "string" && question.trim().length > 0 ? question.trim() : null;

    if (trimmedQuestion && trimmedQuestion.length > 500) {
      return jsonError("That question is too long.", 400);
    }

    const filters = filtersFromParams(request.nextUrl.searchParams);
    const timeZone = resolveTimeZone(membership.organization.timezone);
    const periods = resolvePeriods({ range: filters.range, timeZone });

    const cacheKey = JSON.stringify({
      user: user.id,
      org: membership.organization.id,
      filters,
      question: trimmedQuestion,
    });

    const cached = readCache(cacheKey);
    if (cached) return NextResponse.json(cached);

    const slaConfig = await getSlaConfig(membership.organization.id);

    const report = await buildReport({
      organizationId: membership.organization.id,
      periods,
      filters,
      role: membership.role,
      viewerId: user.id,
      slaConfig,
    });

    const result = await explainAnalytics({
      report,
      question: trimmedQuestion,
      periodLabel: describePeriod(periods.current, timeZone),
    });

    if (!result.ok) {
      const status =
        result.code === "not_configured" || result.code === "provider_error" ? 503 : 422;

      await logAiCall({
        organizationId: membership.organization.id,
        actorId: user.id,
        actorLabel: user.name ?? user.email,
        feature: "explainAnalytics",
        entityType: "organization",
        entityId: membership.organization.id,
        ok: false,
        errorCode: result.code,
      });

      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    await logAiCall({
      organizationId: membership.organization.id,
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      feature: "explainAnalytics",
      entityType: "organization",
      entityId: membership.organization.id,
      ok: true,
    });

    // Explicit: this is narration over the tiles, not a saved finding.
    const payload = { data: result.data, saved: false };
    writeCache(cacheKey, payload);

    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error);
  }
}
