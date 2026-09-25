import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { loadConnections } from "@/lib/agents/registry";
import { RestrictedPanel, SettingsShell } from "../../SettingsShell";
import { CreateAgentFlow } from "./CreateAgentFlow";

export const metadata = { title: "Create agent" };
export const dynamic = "force-dynamic";

export default async function CreateAgentPage() {
  const membership = await requireMembershipOrRedirect();
  const canManage = hasRole(membership.role, ["owner", "admin"]);

  return (
    <SettingsShell
      title="Create agent"
      description="Choose what the agent does first. Who runs it comes next, only if it needs a provider."
      back={{ href: "/settings/agents", label: "Agents" }}
    >
      {canManage ? (
        // Connection STATES only — each adapter's getStatus() returns no key,
        // and loadConnections() forwards nothing but the state and a link.
        <CreateAgentFlow connections={await loadConnections(membership.organization.id)} />
      ) : (
        <RestrictedPanel what="agents" />
      )}
    </SettingsShell>
  );
}
