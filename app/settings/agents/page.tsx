import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SkeletonRows } from "@/components/states";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { listAgents } from "@/lib/agents/queries";
import { AGENT_TYPE_META, createAgentHref, isAgentType, type AgentType } from "@/lib/agents/types";
import { loadConnections } from "@/lib/agents/registry";
import { SettingsShell } from "../SettingsShell";
import { AgentList } from "./AgentList";

export const metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

/**
 * Settings → Agents — the ONE Agent Center.
 *
 * Every member can see the agents working on their pipeline (RLS allows the
 * read, and "what is calling my candidates?" should have an answer for
 * everyone); only Owner/Admin get the create and change controls, and the API
 * and migration 0043's policies refuse the same actions for everyone else.
 */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const membership = await requireMembershipOrRedirect();
  const canManage = hasRole(membership.role, ["owner", "admin"]);
  // Setup's Agents card links each type here as ?type=. Only a view filter:
  // anything that is not a known type is ignored, and the list is still this
  // organization's own agents, read under RLS.
  const { type } = await searchParams;
  const initialType = typeof type === "string" && isAgentType(type) ? type : null;

  return (
    <SettingsShell
      title="Agents"
      description="Create and manage AI agents that power your hiring workflows."
      actions={
        canManage ? (
          <Link className="button is-primary" href="/settings/agents/new">
            <Plus size={16} aria-hidden="true" />
            <span>Create Agent</span>
          </Link>
        ) : null
      }
    >
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <Loader organizationId={membership.organization.id} canManage={canManage} initialType={initialType} />
      </Suspense>
    </SettingsShell>
  );
}

async function Loader({
  organizationId,
  canManage,
  initialType,
}: {
  organizationId: string;
  canManage: boolean;
  initialType: AgentType | null;
}) {
  const [result, connections] = await Promise.all([listAgents(organizationId), loadConnections(organizationId)]);

  if (result.state === "not_set_up") {
    // A different fact from "no agents": the migration isn't applied here.
    return (
      <ErrorState
        headline="The Agent Center isn't set up on this server yet"
        message="Apply migration 0043_agent_center.sql, then reload. Existing voice agents are still in the voice console."
      />
    );
  }
  if (result.state === "error") {
    return <ErrorState headline="Couldn't load agents" message="Nothing has been changed. Reload to try again." />;
  }

  if (result.agents.length === 0) {
    return (
      <div className="card">
        <EmptyState
          headline={initialType ? `No ${AGENT_TYPE_META[initialType].label}s yet` : "No agents yet"}
          message={
            initialType
              ? AGENT_TYPE_META[initialType].purpose
              : "Create your first AI agent to automate screening, interviews, assessments, and candidate communication."
          }
          accent="primary"
          action={
            canManage ? (
              <Link className="button is-primary" href={createAgentHref(initialType)}>
                <Plus size={16} aria-hidden="true" />
                <span>Create Agent</span>
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <AgentList
      agents={result.agents}
      canManage={canManage}
      initialType={initialType}
      providerStates={Object.fromEntries(
        Object.entries(connections.providers).map(([id, connection]) => [id, connection.state])
      )}
    />
  );
}

