import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { loadConnections } from "@/lib/agents/registry";
import { EXTERNALLY_MANAGED, isAgentType } from "@/lib/agents/types";
import { RestrictedPanel, SettingsShell } from "../../SettingsShell";
import { CreateAgentFlow } from "./CreateAgentFlow";

export const metadata = { title: "Create agent" };
export const dynamic = "force-dynamic";

export default async function CreateAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const membership = await requireMembershipOrRedirect();
  const canManage = hasRole(membership.role, ["owner", "admin"]);
  // A starting point only. An unknown type — or one configured on its own page
  // — opens the flow at the type step, exactly as a bare URL does; the API
  // validates whatever is finally submitted.
  const { type } = await searchParams;
  const initialType = typeof type === "string" && isAgentType(type) && !EXTERNALLY_MANAGED[type] ? type : null;

  return (
    <SettingsShell
      title="Create agent"
      description="Choose what the agent does first. Who runs it comes next, only if it needs a provider."
      back={{ href: "/settings/agents", label: "Agents" }}
    >
      {canManage ? (
        // Connection STATES only — each adapter's getStatus() returns no key,
        // and loadConnections() forwards nothing but the state and a link.
        <CreateAgentFlow
          connections={await loadConnections(membership.organization.id)}
          initialType={initialType}
        />
      ) : (
        <RestrictedPanel what="agents" />
      )}
    </SettingsShell>
  );
}
