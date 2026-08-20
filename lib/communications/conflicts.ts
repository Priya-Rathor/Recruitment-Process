// =============================================================================
// Turning a unique-index violation into a sentence somebody can act on.
//
// Two indexes on message_templates can fire on a save, and their remedies are
// different: a duplicate name means "pick another name", while a second ACTIVE
// template for one event means "switch the other one off first" — and that is
// only actionable if it names which one. A bare "could not save that" leaves an
// admin clicking Save again.
//
// Its own module rather than a helper in the route, because both the create and
// the update path need the identical wording and two hand-written copies drift.
// (It cannot live in the route file either: Next validates route exports and
// rejects anything that is not a handler.)
// =============================================================================
import { createClient } from "@/lib/supabase/server";

export async function describeTemplateConflict({
  error,
  organizationId,
  eventKey,
  name,
  excludeId,
}: {
  error: { code?: string; message?: string };
  organizationId: string;
  eventKey: string;
  name: string;
  /** The row being updated, so it is not reported as conflicting with itself. */
  excludeId?: string;
}): Promise<string | null> {
  if (error.code !== "23505") return null;

  if (error.message?.includes("idx_message_templates_unique_name")) {
    return `You already have a template called "${name}".`;
  }

  if (error.message?.includes("idx_message_templates_one_active_per_event")) {
    const supabase = await createClient();

    let query = supabase
      .from("message_templates")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("event_key", eventKey)
      .eq("active", true)
      .limit(1);

    if (excludeId) query = query.neq("id", excludeId);

    const { data } = await query.maybeSingle();
    const other = (data as { name: string } | null)?.name;

    return other
      ? `"${other}" is already the active template for this event. Switch it off first — only ` +
          "one template sends automatically per event, or a candidate would receive two messages."
      : "Another template is already active for this event.";
  }

  return "That template conflicts with one you already have.";
}
