import { Suspense } from "react";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SkeletonRows } from "@/components/states";
import { listMessageTemplates, groupByEvent } from "@/lib/communications/queries";
import { getAllIntegrationHealth } from "@/lib/settings/integrations";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { TemplateLibrary } from "./TemplateLibrary";

export const metadata = { title: "Message templates" };
export const dynamic = "force-dynamic";

export default async function MessageTemplatesSettingsPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/templates"
      title="Message templates"
      description="What this product says to candidates, and which pipeline events say it."
    >
      {!hasRole(membership.role, ["owner", "admin"]) ? (
        <RestrictedPanel what="message templates" />
      ) : (
        <Suspense
          fallback={
            <div className="card">
              <SkeletonRows rows={6} />
            </div>
          }
        >
          <Library organizationId={membership.organization.id} />
        </Suspense>
      )}
    </SettingsShell>
  );
}

async function Library({ organizationId }: { organizationId: string }) {
  const [{ templates, failed }, integrations] = await Promise.all([
    listMessageTemplates(organizationId),
    // Read so the page can say which channels will actually deliver TODAY.
    // A library full of active WhatsApp templates on a disconnected integration
    // looks like it is working; saying so up front is the difference between a
    // configuration screen and a promise.
    getAllIntegrationHealth(organizationId),
  ]);

  if (failed) {
    return (
      <div className="card" style={{ borderColor: "var(--color-error)" }}>
        <h2 className="title is-5" style={{ color: "var(--color-error)" }}>
          Couldn&apos;t load your templates
        </h2>
        <p className="has-text-secondary" style={{ fontSize: 14 }}>
          Nothing has been changed. Reload the page to try again — and until it loads, treat the
          library as unknown rather than empty.
        </p>
      </div>
    );
  }

  const emailConnected =
    integrations.find((integration) => integration.provider === "email")?.status === "connected";
  const whatsappConnected =
    integrations.find((integration) => integration.provider === "whatsapp")?.status === "connected";

  return (
    <TemplateLibrary
      groups={groupByEvent(templates)}
      emailConnected={emailConnected}
      whatsappConnected={whatsappConnected}
    />
  );
}
