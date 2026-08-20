// =============================================================================
// Resolving a "Send templated message" action, server-side.
//
// SEPARATE FROM lib/communications/templates.ts BECAUSE THIS TOUCHES THE DATABASE.
// That module is imported by client components — the automation builder, the
// template editor, the send panel — and a server Supabase client reaching a client
// bundle is a build error at best and a leaked import at worst. Pure template logic
// lives there; anything that reads a row lives here.
//
// WHY THE API MUST CALL THIS AT ALL.
//
// A rule's action config is CLIENT-AUTHORED DATA. validateRule() in the automation
// catalogue checks its SHAPE, but a pure function cannot check the one thing that
// matters: whether the template id belongs to the caller's organization. A rule
// carrying another tenant's id would make the engine read and send that
// organization's wording — a cross-tenant leak arriving as a configuration value.
//
// So this OVERWRITES the derived fields from the row it verified rather than
// trusting what arrived. A client that lied about the channels gets the truth
// stored instead of an error, because the lie is not the point — the stored copy
// only feeds the activation check, and it must simply be correct.
// =============================================================================
import type { Action } from "@/lib/automations/catalog";
import { createClient } from "@/lib/supabase/server";

export type ResolvedActions =
  | { ok: true; actions: Action[] }
  | { ok: false; error: string };

export async function resolveTemplatedMessageActions({
  organizationId,
  actions,
}: {
  organizationId: string;
  actions: Action[];
}): Promise<ResolvedActions> {
  const ids = actions
    .filter((action) => action.type === "send_templated_message")
    .map((action) => action.config?.template_id)
    .filter((id): id is string => typeof id === "string");

  if (ids.length === 0) return { ok: true, actions };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("message_templates")
    .select("id, name, event_key, channel")
    .eq("organization_id", organizationId)
    .in("id", ids);

  if (error) {
    // Refused rather than stored unverified. A rule saved with an unchecked
    // template id is a rule whose next run reads a row nobody proved was ours.
    return { ok: false, error: "Could not check that message template. Nothing was saved." };
  }

  const found = new Map(
    ((data ?? []) as { id: string; name: string; event_key: string; channel: string }[]).map(
      (row) => [row.id, row]
    )
  );

  const resolved: Action[] = [];

  for (const action of actions) {
    if (action.type !== "send_templated_message") {
      resolved.push(action);
      continue;
    }

    const templateId = action.config?.template_id as string;
    const template = found.get(templateId);

    // Another organization's id and a deleted one produce the same message, so a
    // guessed id cannot be used to discover that a template exists elsewhere.
    if (!template) {
      return { ok: false, error: "That message template doesn't exist." };
    }

    resolved.push({
      type: action.type,
      config: {
        template_id: template.id,
        // From the ROW, never from the request.
        event_key: template.event_key,
        channels: template.channel === "both" ? ["email", "whatsapp"] : [template.channel],
      },
    });
  }

  return { ok: true, actions: resolved };
}
