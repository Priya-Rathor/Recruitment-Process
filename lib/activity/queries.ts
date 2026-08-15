// Activity reads. Writes go through logActivity() in log.ts, never through here.
import { createClient } from "@/lib/supabase/server";
import { describeEvent } from "@/lib/activity/events";
import type { ActivityEntityType, ActivityEvent } from "@/lib/activity/types";
import { describeDbError } from "@/lib/supabase/errors";

const EVENT_COLUMNS =
  "id, organization_id, entity_type, entity_id, event_type, actor_id, actor_label, " +
  "metadata, is_sensitive, created_at";

export type ActivityRow = ActivityEvent & {
  /** Rendered sentence. Derived on read so a catalogue fix improves old rows. */
  description: string;
  actor_name: string | null;
};

export type ActivityFilters = {
  entityType?: ActivityEntityType | null;
  entityId?: string | null;
  eventType?: string | null;
  actorId?: string | null;
  /** true = only the Owner/Admin audit slice; false = only ordinary events. */
  sensitiveOnly?: boolean;
  since?: string | null;
};

export function activityFiltersFromParams(params: URLSearchParams): ActivityFilters {
  return {
    entityType: (params.get("entity_type") as ActivityEntityType) || null,
    entityId: params.get("entity_id"),
    eventType: params.get("event_type"),
    actorId: params.get("actor_id"),
    since: params.get("since"),
  };
}

/**
 * Lists events.
 *
 * Note what is NOT here: any role check on `sensitiveOnly`. The RLS policy
 * already hides sensitive rows from a Recruiter or Viewer, so a caller asking
 * for them simply gets nothing back rather than being refused. The route checks
 * the role too, for a readable 403 instead of a confusing empty page.
 */
export async function listActivity({
  organizationId,
  filters = {},
  limit = 50,
  offset = 0,
}: {
  organizationId: string;
  filters?: ActivityFilters;
  limit?: number;
  offset?: number;
}): Promise<{ events: ActivityRow[]; total: number; failed: boolean }> {
  const supabase = await createClient();

  let query = supabase
    .from("activity_events")
    .select(`${EVENT_COLUMNS}, actor:users!activity_events_actor_id_fkey(name, email)`, {
      count: "exact",
    })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.eventType) query = query.eq("event_type", filters.eventType);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.sensitiveOnly === true) query = query.eq("is_sensitive", true);
  if (filters.sensitiveOnly === false) query = query.eq("is_sensitive", false);
  if (filters.since) query = query.gte("created_at", filters.since);

  const { data, error, count } = await query;

  if (error) {
    console.error("[activity] list failed:", describeDbError(error));
    return { events: [], total: 0, failed: true };
  }

  const rows = (data ?? []) as unknown as (ActivityEvent & {
    actor: { name: string | null; email: string } | null;
  })[];

  return {
    events: rows.map((row) => ({
      ...row,
      description: describeEvent(row.event_type, row.metadata ?? {}),
      // Live join first, snapshot second: a renamed user should read correctly,
      // a deleted one should still read at all.
      actor_name: row.actor?.name ?? row.actor?.email ?? row.actor_label ?? null,
    })),
    total: count ?? 0,
    failed: false,
  };
}

/**
 * One entity's timeline.
 *
 * Accepts several (type, id) pairs because a candidate's story is spread across
 * tables — the candidate row, their applications, their resumes. Asking only for
 * entity_type='candidate' would show a nearly empty timeline while the real
 * history sat under the application.
 */
export async function getEntityTimeline({
  organizationId,
  targets,
  limit = 200,
}: {
  organizationId: string;
  targets: { entityType: ActivityEntityType; entityId: string }[];
  limit?: number;
}): Promise<{ events: ActivityRow[]; failed: boolean }> {
  if (targets.length === 0) return { events: [], failed: false };

  const supabase = await createClient();

  const ids = [...new Set(targets.map((target) => target.entityId))];

  const { data, error } = await supabase
    .from("activity_events")
    .select(`${EVENT_COLUMNS}, actor:users!activity_events_actor_id_fkey(name, email)`)
    .eq("organization_id", organizationId)
    .in("entity_id", ids)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[activity] timeline failed:", describeDbError(error));
    return { events: [], failed: true };
  }

  const allowed = new Set(targets.map((target) => `${target.entityType}:${target.entityId}`));

  const rows = (data ?? []) as unknown as (ActivityEvent & {
    actor: { name: string | null; email: string } | null;
  })[];

  return {
    events: rows
      // A UUID collision across entity types is vanishingly unlikely, but the
      // pair is what was asked for, so the pair is what is returned.
      .filter((row) => allowed.has(`${row.entity_type}:${row.entity_id}`))
      .map((row) => ({
        ...row,
        description: describeEvent(row.event_type, row.metadata ?? {}),
        actor_name: row.actor?.name ?? row.actor?.email ?? row.actor_label ?? null,
      })),
    failed: false,
  };
}

/**
 * Every entity id belonging to one candidate — the candidate row plus their
 * applications, resumes, calls, reports and interviews.
 *
 * This is what makes "What's happened with Rahul?" answerable: without it the
 * narrative would be built from a fraction of the story and would read as though
 * nothing had happened.
 */
export async function candidateTimelineTargets({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<{ entityType: ActivityEntityType; entityId: string }[]> {
  const supabase = await createClient();

  const targets: { entityType: ActivityEntityType; entityId: string }[] = [
    { entityType: "candidate", entityId: candidateId },
  ];

  const { data: applications } = await supabase
    .from("applications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId);

  const applicationIds = ((applications ?? []) as { id: string }[]).map((row) => row.id);
  for (const id of applicationIds) targets.push({ entityType: "application", entityId: id });

  const { data: resumes } = await supabase
    .from("resumes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId);

  for (const row of (resumes ?? []) as { id: string }[]) {
    targets.push({ entityType: "resume", entityId: row.id });
  }

  if (applicationIds.length > 0) {
    const [{ data: calls }, { data: reports }, { data: interviews }] = await Promise.all([
      supabase
        .from("screening_calls")
        .select("id")
        .eq("organization_id", organizationId)
        .in("application_id", applicationIds),
      supabase
        .from("screening_reports")
        .select("id")
        .eq("organization_id", organizationId)
        .in("application_id", applicationIds),
      supabase
        .from("interviews")
        .select("id")
        .eq("organization_id", organizationId)
        .in("application_id", applicationIds),
    ]);

    for (const row of (calls ?? []) as { id: string }[]) {
      targets.push({ entityType: "screening_call", entityId: row.id });
    }
    for (const row of (reports ?? []) as { id: string }[]) {
      targets.push({ entityType: "screening_report", entityId: row.id });
    }
    for (const row of (interviews ?? []) as { id: string }[]) {
      targets.push({ entityType: "interview", entityId: row.id });
    }
  }

  return targets;
}
