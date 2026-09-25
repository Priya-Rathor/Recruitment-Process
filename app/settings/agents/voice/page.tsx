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
import { getOrganizationSettings } from "@/lib/settings/queries";
import { ScreeningForm } from "./ScreeningForm";
import { VoiceAgentConsole } from "./VoiceAgentConsole";

export const metadata = { title: "Voice agents" };
export const dynamic = "force-dynamic";

/**
 * /settings/agents/voice — the voice agent console, inside the Agent Center.
 *
 * MOVED from /settings/integrations/bolna, which now redirects here. The old
 * URL filed agent configuration under the provider that executes it; an
 * integration is a connection, an agent is what uses it, and only the
 * connection belongs in Integrations. The page content was already
 * provider-neutral, so nothing on it changed but the way back.
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
      title="Voice agents"
      description="What a voice screening agent says, how it sounds, and how it behaves on the call."
      // Back to the Agent Center, which owns every agent. The Bolna integration
      // (credentials, connection) stays in Integrations; this page is agents only.
      back={{ href: "/settings/agents", label: "Agents" }}
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
  const [
    { agents, notBuilt, failed },
    catalog,
    status,
    jobs,
    costEstimate,
    orgSettings,
  ] = await Promise.all([
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
    getOrganizationSettings(organizationId),
  ]);

  if (failed)
    return <ErrorState message="Couldn't load the voice agent settings." />;

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
        <p
          className="has-text-secondary"
          style={{ fontSize: "var(--text-body)" }}
        >
          The voice agent tables haven&apos;t been created. An operator needs to
          apply migration <code>0034_module24_voice_agent_console.sql</code>.
          Screening calls keep working with the existing configuration in the
          meantime.
        </p>
      </div>
    );
  }

  // Only for the agent the console opens on — a switch loads the other agent's
  // own history through its own request rather than pre-fetching all of them.
  const opening =
    agents.find((agent) => agent.id === requestedAgentId) ?? agents[0];
  const initialTestCall = opening
    ? await getLatestTestCall({ organizationId, agentId: opening.id })
    : null;

  return (
    <>
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

      {/*
      CALL RULES — moved here from the retired "Screening" settings page, which
      now redirects to #call-rules. They are part of the voice screening
      agent's behaviour (how often it may telephone somebody, in which
      language, whether it records), so they live with the agent, not in a
      separate "defaults" card. ONE set per organization, not per agent: the
      screening scheduler reads them for every call, whichever agent places it,
      and this card says so rather than implying a per-agent setting that
      nothing reads. Its own Save, because it is its own record.
    */}
      <section
        id="call-rules"
        className="card mt-5"
        aria-labelledby="call-rules-title"
      >
        <h2 id="call-rules-title" className="title is-5 mb-1">
          Call rules
        </h2>
        <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
          Apply to every voice screening agent in your organization.
        </p>
        {orgSettings.failed ? (
          <ErrorState message="Couldn't load the call rules." />
        ) : (
          <ScreeningForm initial={orgSettings.settings.screening_settings} />
        )}
      </section>
    </>
  );
}
