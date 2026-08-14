import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import {
  availableMetrics,
  getDashboardData,
  METRIC_LABELS,
  type MetricKey,
} from "@/lib/dashboard/metrics";
import { generateDailyBrief } from "@/lib/ai/generateDailyBrief";
import { dayKeyInZone, resolveTimeZone } from "@/lib/time";

/**
 * Short-lived response cache.
 *
 * The AI & Calling Cost Model chapter requires this class of endpoint to be
 * cached/cooled-down, because "Can be called repeatedly by an impatient user".
 * The key includes the figures themselves, so the brief is regenerated the
 * moment the underlying numbers change — but a user clicking Refresh five times
 * pays for one call.
 *
 * LIMITATION: in-process, so it does not survive a redeploy and is per-instance
 * on serverless. Adequate as a cost guard at this scale; the cost-tracking
 * retrofit should replace it with a shared store alongside ai_usage_events.
 */
const CACHE_TTL_MS = 3 * 60 * 1000;
const briefCache = new Map<string, { at: number; payload: unknown }>();

function readCache(key: string) {
  const hit = briefCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    briefCache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeCache(key: string, payload: unknown) {
  // Bounded so a long-lived instance can't grow this without limit.
  if (briefCache.size > 500) briefCache.clear();
  briefCache.set(key, { at: Date.now(), payload });
}

/** Days-without-movement threshold; mirrors OVERDUE_DAYS in the metrics layer. */
const OVERDUE_DAYS = 3;

/**
 * POST /api/dashboard/ai-action — generates the Daily Operations Brief.
 *
 * All four roles may view the brief (spec section 9), Recruiters within their
 * own scope — which is enforced by getDashboardData(), not by this handler.
 *
 * The brief is derived strictly from the counts the dashboard already computed
 * and is returned unsaved: nothing is written to any table.
 */
export async function POST() {
  try {
    const membership = await requireMembership();
    const timezone = resolveTimeZone(membership.organization.timezone);

    // Recompute server-side rather than trusting counts from the client — a
    // caller could otherwise feed the model any numbers it liked.
    const dashboard = await getDashboardData({
      organizationId: membership.organization.id,
      role: membership.role,
      recruiterUserId: membership.user_id,
      timezone,
    });

    // Only metrics that actually resolved. A pending/errored metric is omitted
    // entirely rather than passed as 0, so the brief can't report "0 interviews"
    // when the truth is "we cannot see interviews yet".
    const resolved = availableMetrics(dashboard.metrics);
    const counts = Object.entries(resolved).reduce<Record<string, number>>(
      (accumulator, [key, value]) => {
        accumulator[METRIC_LABELS[key as MetricKey]] = value;
        return accumulator;
      },
      {}
    );

    const cacheKey = JSON.stringify([
      membership.organization.id,
      membership.user_id,
      dashboard.scope,
      dayKeyInZone(timezone),
      counts,
      dashboard.attention.length,
    ]);

    const cached = readCache(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });

    const result = await generateDailyBrief({
      counts,
      attentionCount: dashboard.attention.length,
      overdueDays: OVERDUE_DAYS,
      scope: dashboard.scope,
    });

    if (!result.ok) {
      // 422 = we got output we could not trust (including a brief that cited a
      // figure we never supplied); 503 = provider unavailable or unconfigured.
      // Either way the dashboard itself keeps working without the brief.
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // TODO(Module 14): log this AI call at summary level to activity_events
    // once logActivity() exists — required by the Module 14 retrofit.
    const payload = { data: result.data, saved: false };
    writeCache(cacheKey, payload);

    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error);
  }
}
