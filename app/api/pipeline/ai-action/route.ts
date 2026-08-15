import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logAiCall } from "@/lib/activity/log";
import { boardToPipelineItems, getBoard } from "@/lib/pipeline/queries";
import { prioritizePipeline } from "@/lib/ai/prioritizePipeline";

export const maxDuration = 60;

/**
 * Short response cache.
 *
 * The cost chapter names this endpoint specifically: "'Ask Pipeline AI' ... can
 * be called repeatedly by an impatient user — needs a short cache/cooldown."
 * Keyed on the caller AND the board state, so a genuine change produces a fresh
 * answer while repeated clicks do not.
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
 * POST /api/pipeline/ai-action — "what should I work on first?"
 *
 * The board is rebuilt server-side with the caller's own scoping, and only that
 * output reaches the model. It is therefore incapable of suggesting work on an
 * application the caller cannot see — the spec's test holds by construction
 * rather than by checking the answer afterwards.
 *
 * Owner/Admin/Recruiter. Viewer denied: the permissions table grants Viewer the
 * board but not Ask Pipeline AI, and a read-only user should not spend the
 * organization's AI budget.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine — the whole board is the default question.
    }

    const jobId = (body as Record<string, unknown> | null)?.job_id;
    const scopedJobId = typeof jobId === "string" && jobId.length > 0 ? jobId : null;

    const board = await getBoard({
      organizationId: membership.organization.id,
      viewerRole: membership.role,
      viewerId: membership.user_id,
      jobId: scopedJobId,
    });

    if (board.failed) return jsonError("Could not read the pipeline.", 400);

    const items = boardToPipelineItems(board);

    // Cache key includes the caller (scoping differs by role) and a digest of
    // the board, so any real movement invalidates it.
    const cacheKey = JSON.stringify([
      membership.organization.id,
      membership.user_id,
      scopedJobId,
      items.map((item) => `${item.id}:${item.stage}:${item.daysInStage}:${item.awaitingScreeningReview}`),
    ]);

    const cached = readCache(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), cached: true });

    const result = await prioritizePipeline(items);

    if (!result.ok) {
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // Module 14 (section 10): every AI call recorded at summary level — which
    // feature ran and whether it worked. Never the prompt or the completion:
    // those carry candidate personal data, and this table is append-only.
    const aiActor = await requireCurrentUser();
    await logAiCall({
      organizationId: membership.organization.id,
      actorId: aiActor.id,
      actorLabel: aiActor.name ?? aiActor.email,
      feature: "prioritizePipeline",
      entityType: "application",
      entityId: null,
      ok: true,
    });

    const payload = {
      data: result.data,
      // Explicit: this is advice. Nothing was moved.
      applied: false,
      itemsConsidered: items.length,
    };

    writeCache(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error);
  }
}
