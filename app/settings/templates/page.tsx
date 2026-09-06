import { listDefinitions } from "@/lib/customFields/queries";
import { customPlaceholderFields } from "@/lib/customFields/placeholders";
import { Suspense } from "react";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SkeletonRows } from "@/components/states";
import { listMessageTemplates, groupByEvent } from "@/lib/communications/queries";
import { getAllIntegrationHealth } from "@/lib/settings/integrations";
import { SettingsShell } from "../SettingsShell";
import { TemplateLibrary } from "./TemplateLibrary";

export const metadata = { title: "Message templates" };
export const dynamic = "force-dynamic";

export default async function MessageTemplatesSettingsPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <SettingsShell
      title="Message templates"
      description="What this product says to candidates, and which pipeline events say it."
    >
      {/*
        EVERY ROLE READS; OWNER/ADMIN WRITE.

        This used to show RestrictedPanel to a Recruiter, which was the wrong
        refusal: a recruiter about to move somebody to Rejected should be able to
        see exactly what that candidate is about to receive. Not being able to see
        it is how a recruiter gets surprised by a message they did not know the
        product sent.

        `canManage` is passed down rather than the role, so the library asks one
        question instead of re-deriving the rule. The API routes and the RLS
        policies in migration 0035 enforce the same split independently — this only
        decides what to draw.
      */}
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={6} />
          </div>
        }
      >
        <Library
          organizationId={membership.organization.id}
          timeZone={membership.organization.timezone}
          canManage={hasRole(membership.role, ["owner", "admin"])}
        />
      </Suspense>
    </SettingsShell>
  );
}

async function Library({
  organizationId,
  timeZone,
  canManage,
}: {
  organizationId: string;
  /** The ORGANIZATION's timezone, so dates read the same on server and client. */
  timeZone: string;
  canManage: boolean;
}) {
  const [{ templates, failed }, integrations, customDefinitions] = await Promise.all([
    listMessageTemplates(organizationId),
    // Read so the page can say which channels will actually deliver TODAY.
    // A library full of active WhatsApp templates on a disconnected integration
    // looks like it is working; saying so up front is the difference between a
    // configuration screen and a promise.
    getAllIntegrationHealth(organizationId),
    /*
      MODULE 27. Loaded here, on the server, and handed to the picker as data.

      ALL entities, not just one: a message about an application legitimately
      references the job's custom fields and the candidate's, so narrowing this
      would hide tokens that do resolve.
    */
    listDefinitions(organizationId),
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
      customFields={customPlaceholderFields(customDefinitions)}
      groups={groupByEvent(templates)}
      emailConnected={emailConnected}
      whatsappConnected={whatsappConnected}
      timeZone={timeZone}
      canManage={canManage}
    />
  );
}
