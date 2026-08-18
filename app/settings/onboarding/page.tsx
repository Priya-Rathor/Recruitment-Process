import Link from "next/link";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { listDocumentTemplates } from "@/lib/onboarding/queries";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { ErrorState } from "@/components/states";
import { SCHEMA_OUT_OF_DATE_MESSAGE } from "@/lib/supabase/errors";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { DocumentTemplates } from "./DocumentTemplates";

export const metadata = { title: "Onboarding documents" };
export const dynamic = "force-dynamic";

/**
 * MODULE 19 — the organization's onboarding document checklist.
 *
 * Owner/Admin only. A Recruiter can read the templates (the names appear on every
 * hire's page) but not decide them: whether a relieving letter is required is an
 * organization-wide policy, not a per-recruiter preference.
 */
export default async function OnboardingSettingsPage() {
  const membership = await requireMembershipOrRedirect();
  const canEdit = hasRole(membership.role, ["owner", "admin"]);

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/onboarding"
      title="Onboarding documents"
      description="The checklist every new hire is asked for, once an application reaches Hired."
    >
      {!canEdit ? (
        <RestrictedPanel what="onboarding documents" />
      ) : (
        <OnboardingSettingsBody organizationId={membership.organization.id} />
      )}
    </SettingsShell>
  );
}

async function OnboardingSettingsBody({ organizationId }: { organizationId: string }) {
  const [{ templates, failed, schemaOutOfDate }, { settings }] = await Promise.all([
    listDocumentTemplates({ organizationId, includeInactive: true }),
    getOrganizationSettings(organizationId),
  ]);

  if (failed) {
    return (
      <ErrorState
        headline={schemaOutOfDate ? "Database migration pending" : "Couldn't load this"}
        message={
          schemaOutOfDate
            ? SCHEMA_OUT_OF_DATE_MESSAGE
            : "Couldn't load the document checklist."
        }
      />
    );
  }

  return (
    <>
      <DocumentTemplates
        initial={templates}
        reminderDays={settings.onboarding_settings.pendingReminderDays}
      />

      <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
        Hires in progress are on the <Link href="/hires">Onboarding</Link> page. A record
        appears there automatically when an application reaches Hired — there is no separate
        &ldquo;start onboarding&rdquo; step.
      </p>
    </>
  );
}
