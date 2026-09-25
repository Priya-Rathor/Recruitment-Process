import { Suspense } from "react";
import { hasRole, requireMembershipOrRedirect } from "@/lib/tenant";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { getStatus, listAgentCatalog } from "@/lib/integrations/bolna";
import {
  getLatestTestCall,
  listPreviewJobs,
  listVoiceAgents,
} from "@/lib/voice/queries";
import { getAgentCostEstimate } from "@/lib/voice/cost";
import { RestrictedPanel, SettingsShell } from "../../SettingsShell";
import { VoiceAgentConsole } from "./VoiceAgentConsole";

export const metadata = { title: "Voice Agent Console" };
export const dynamic = "force-dynamic";

/**
 * /settings/integrations/bolna — the Voice Agent Console.
 *
 * The route segment is the provider's name because that is what this integration
 * is called internally, and the console's spec allows exactly that: "It's fine
 * that this page lives under /settings/integrations/bolna as a URL/internal route
 * name — the PAGE CONTENT itself stays provider-neutral in its labels."
 *
 * OWNER/ADMIN ONLY, checked here AND in every route the page calls. The Settings
 * shell hides what a role cannot open rather than greying it out, and this page
 * re-checks independently — a Recruiter who types the URL gets the restricted
 * panel, not a form they cannot save.
 */
export default async function VoiceAgentConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const membership = await requireMembershipOrRedirect();
  // The Agent Center's "Manage" link opens the console on that agent. Only a
  // hint: it is matched against this organization's own agents below, so an id
  // from anywhere else simply opens the first one.
  const { agent } = await searchParams;
  const requestedAgentId = typeof agent === "string" ? agent : null;

  return (
    <SettingsShell
      title="Voice Agent Console"
      description="What the automated screening call says, how it sounds, and how it behaves."
      // One level up, not all the way to the grid: this page lives inside the
      // integration that owns it, and the shell's default would skip it.
      back={{ href: "/settings/integrations", label: "Integrations" }}
    >
      {!hasRole(membership.role, ["owner", "admin"]) ? (
        <RestrictedPanel what="the voice agent" />
      ) : (
        <Suspense
          fallback={
            <div className="card">
              <SkeletonRows rows={6} />
            </div>
          }
        >
          <ConsoleBody
            organizationId={membership.organization.id}
            organizationName={membership.organization.name}
            requestedAgentId={requestedAgentId}
          />
        </Suspense>
      )}
    </SettingsShell>
  );
}

async function ConsoleBody({
  organizationId,
  organizationName,
  requestedAgentId,
}: {
  organizationId: string;
  organizationName: string;
  requestedAgentId: string | null;
}) {
  // In parallel: nothing here depends on anything else here, and the catalogue
  // involves a provider round trip that must not delay the rest of the page.
  const [{ agents, notBuilt, failed }, catalog, status, jobs, costEstimate] = await Promise.all([
    listVoiceAgents({ organizationId, companyName: organizationName }),
    listAgentCatalog(organizationId),
    getStatus(organizationId),
    listPreviewJobs({ organizationId }),
    /*
      From OUR usage ledger. Returns an explicit `not_tracked` state today,
      because the Cost & Budget Guardrails feature is specified but unbuilt — the
      header says so in words rather than inventing a figure. See lib/voice/cost.
    */
    getAgentCostEstimate({ organizationId }),
  ]);

  if (failed) return <ErrorState message="Couldn't load the voice agent settings." />;

  if (notBuilt) {
    /*
      An explicit pending state, not an empty form. "You have no agents" and
      "migration 0034 has not been applied on this server" are different facts,
      and offering a Create button that cannot work would waste the admin's time
      and look like our bug.
    */
    return (
      <div className="card">
        <h2 className="title is-5">Not set up on this server yet</h2>
        <p className="has-text-secondary" style={{ fontSize: "var(--text-body)" }}>
          The voice agent tables haven&apos;t been created. An operator needs to apply migration{" "}
          <code>0034_module24_voice_agent_console.sql</code>. Screening calls keep working with the
          existing configuration in the meantime.
        </p>
      </div>
    );
  }

  // Only for the agent the console opens on — a switch loads the other agent's
  // own history through its own request rather than pre-fetching all of them.
  const opening = agents.find((agent) => agent.id === requestedAgentId) ?? agents[0];
  const initialTestCall = opening
    ? await getLatestTestCall({ organizationId, agentId: opening.id })
    : null;

  return (
    <VoiceAgentConsole
      initialAgents={agents}
      initialActiveId={opening?.id ?? null}
      catalog={catalog}
      connection={{
        connected: status.status === "connected",
        encryptionUnavailable: status.encryptionUnavailable,
      }}
      jobs={jobs}
      initialTestCall={initialTestCall}
      costEstimate={costEstimate}
      organizationName={organizationName}
    />
  );
}
