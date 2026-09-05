// =============================================================================
// What the builder's pickers can offer. SERVER ONLY.
//
// One query per referenced object type, loaded server-side and passed to the
// client component as props. The alternative — four fetch effects inside the
// builder — is what AGENTS.md rules against ("prefer loading data in server
// components"), and it would also mean the picker renders empty for a moment
// every time somebody expands a stage.
//
// EVERY QUERY IS TENANT-SCOPED EXPLICITLY, even though these run under the
// session client and RLS would scope them anyway. The rule holds regardless of
// client, and it means moving one of these reads to the admin client later
// cannot silently widen it.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { formatDbError } from "@/lib/supabase/errors";
import type { CommunicationEventKey } from "@/lib/communications/events";
import type { TemplateChannel } from "@/lib/communications/templates";

export type TemplateOption = {
  id: string;
  name: string;
  eventKey: CommunicationEventKey;
  channel: TemplateChannel;
  active: boolean;
};

export type FormOption = { id: string; name: string; status: string };
export type AgentOption = { id: string; name: string; purpose: string; isDefault: boolean };
export type MemberOption = { userId: string; name: string; email: string; role: string };

export type WorkflowOptions = {
  templates: TemplateOption[];
  forms: FormOption[];
  agents: AgentOption[];
  members: MemberOption[];
  /**
   * Which of the four reads failed, if any.
   *
   * NOT collapsed into a single boolean. A builder whose template list failed to
   * load must say "message templates couldn't be loaded" on the template picker
   * — not render an empty select that looks like "you have no templates", which
   * would send somebody off to create a duplicate of one they already have.
   */
  failed: ("templates" | "forms" | "agents" | "members")[];
};

export async function loadWorkflowOptions(organizationId: string): Promise<WorkflowOptions> {
  const supabase = await createClient();
  const failed: WorkflowOptions["failed"] = [];

  const [templates, forms, agents, members] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id, name, event_key, channel, active")
      .eq("organization_id", organizationId)
      .order("name"),
    supabase
      .from("forms")
      .select("id, name, status")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("voice_agents")
      .select("id, name, purpose, is_default")
      .eq("organization_id", organizationId)
      .order("name"),
    supabase
      .from("organization_members")
      /**
       * THE FOREIGN KEY IS NAMED, and it has to be.
       *
       * organization_members points at `users` TWICE — once as `user_id` (the
       * member) and once as `invited_by` (whoever invited them). An unqualified
       * `users` embed is ambiguous and PostgREST refuses it rather than guessing,
       * which is the right behaviour: guessing wrong here would list the people
       * who sent invitations instead of the people who are in the organization.
       *
       * Every other reader in this codebase names the constraint the same way —
       * see lib/jobs/queries.ts and app/team/invite/page.tsx.
       */
      .select("user_id, role, user:users!organization_members_user_id_fkey(name, email)")
      .eq("organization_id", organizationId),
  ]);

  if (templates.error) {
    console.error(`[workflow] templates load failed: ${formatDbError(templates.error)}`);
    failed.push("templates");
  }
  if (forms.error) {
    console.error(`[workflow] forms load failed: ${formatDbError(forms.error)}`);
    failed.push("forms");
  }
  if (agents.error) {
    console.error(`[workflow] agents load failed: ${formatDbError(agents.error)}`);
    failed.push("agents");
  }
  if (members.error) {
    console.error(`[workflow] members load failed: ${formatDbError(members.error)}`);
    failed.push("members");
  }

  return {
    failed,
    templates: ((templates.data ?? []) as unknown as {
      id: string;
      name: string;
      event_key: CommunicationEventKey;
      channel: TemplateChannel;
      active: boolean;
    }[]).map((row) => ({
      id: row.id,
      name: row.name,
      eventKey: row.event_key,
      channel: row.channel,
      active: row.active,
    })),
    forms: ((forms.data ?? []) as unknown as FormOption[]).map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
    })),
    agents: ((agents.data ?? []) as unknown as {
      id: string;
      name: string;
      purpose: string;
      is_default: boolean;
    }[]).map((row) => ({
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      isDefault: row.is_default,
    })),
    members: ((members.data ?? []) as unknown as {
      user_id: string;
      role: string;
      user: { name: string | null; email: string } | null;
    }[]).map((row) => ({
      userId: row.user_id,
      // Falling back to the email rather than to "Unknown": a picker entry
      // reading "Unknown" is unselectable in practice, and every user row has an
      // email even when nobody has set a display name.
      name: row.user?.name?.trim() || row.user?.email || "A team member",
      email: row.user?.email ?? "",
      role: row.role,
    })),
  };
}
