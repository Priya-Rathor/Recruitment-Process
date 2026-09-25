import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getAgent } from "@/lib/agents/queries";
import { AGENT_TYPE_META } from "@/lib/agents/types";
import { RestrictedPanel, SettingsShell } from "../../SettingsShell";
import { AgentEditor } from "./AgentEditor";

export const metadata = { title: "Edit agent" };
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, membership] = await Promise.all([params, requireMembershipOrRedirect()]);
  if (!UUID_PATTERN.test(id)) notFound();

  // organization_id AND id: another tenant's agent is simply not found.
  const agent = await getAgent(membership.organization.id, id);
  if (!agent) notFound();

  return (
    <SettingsShell
      title={agent.name}
      description={AGENT_TYPE_META[agent.type].label}
      back={{ href: "/settings/agents", label: "Agents" }}
    >
      {hasRole(membership.role, ["owner", "admin"]) ? (
        <>
          {agent.type === "voice_screening" && (
            <div className="card mb-4">
              <p style={{ fontSize: 14 }}>
                Call settings — the prompt, voice, greeting and test calls — are edited in the voice
                console, which is what the call actually uses.
              </p>
              <Link className="button is-outlined-primary mt-3" href={`/settings/integrations/bolna?agent=${agent.id}`}>
                Open in voice console
              </Link>
            </div>
          )}
          <AgentEditor agent={agent} />
        </>
      ) : (
        <RestrictedPanel what="agents" />
      )}
    </SettingsShell>
  );
}
