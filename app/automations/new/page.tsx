import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { AutomationForm } from "../AutomationForm";
import { TemplatePicker } from "./TemplatePicker";
import { RULE_TEMPLATES } from "@/lib/automations/templates";
import { listTeamMembers } from "@/lib/automations/queries";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { getStatus as getEmailStatus } from "@/lib/integrations/email";
import { getStatus as getLlmStatus } from "@/lib/integrations/llm";
import { getStatus as getWhatsAppStatus } from "@/lib/integrations/whatsapp";
import { listMessageTemplates } from "@/lib/communications/queries";

export const metadata = { title: "New automation" };
export const dynamic = "force-dynamic";

export default async function NewAutomationPage() {
  const membership = await requireMembershipOrRedirect();

  // Spec section 9: "Create/edit automations — Recruiter: No, Viewer: No".
  // Blocked, not greyed out; the API and RLS refuse it independently.
  if (!hasRole(membership.role, ["owner", "admin"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">You can&apos;t create automations</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Only an Owner or Admin can create rules that act on candidates. You can still see every
            rule and its run history.
          </p>
          <Link className="button" href="/automations">
            Back to automations
          </Link>
        </div>
      </AppShell>
    );
  }

  // Which integrations are missing, so a template can say so BEFORE it is picked
  // rather than at activation. Read in parallel; a failed read reports the
  // integration as not connected, which is the cautious direction for a warning.
  const [teamMembers, bolna, email, llm, whatsapp, { templates }] = await Promise.all([
    listTeamMembers(membership.organization.id),
    getBolnaStatus(membership.organization.id),
    getEmailStatus(membership.organization.id),
    getLlmStatus(membership.organization.id),
    // Module 15's channel, so a rule using "Send templated message" is warned
    // about a disconnected WhatsApp the same way one using a call is warned about
    // Bolna.
    getWhatsAppStatus(membership.organization.id),
    listMessageTemplates(membership.organization.id),
  ]);

  const disconnected = [
    bolna.status !== "connected" ? "bolna" : null,
    email.status !== "connected" ? "email" : null,
    llm.status !== "connected" ? "llm" : null,
    whatsapp.status !== "connected" ? "whatsapp" : null,
  ].filter((provider): provider is string => provider !== null);

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/automations">Automations</Link> / New
        </p>
        <h1 className="title is-4 mb-1">New automation</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Saved as a draft. Activation is a separate step.
        </p>
      </div>

      <TemplatePicker templates={RULE_TEMPLATES} disconnected={disconnected} />

      <AutomationForm
        mode="create"
        canUseAi
        teamMembers={teamMembers}
        messageTemplates={templates}
      />
    </AppShell>
  );
}
