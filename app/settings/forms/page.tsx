// =============================================================================
// Settings -> Forms.
//
// ONE LIST FOR BOTH KINDS, and that is the point of the module: a job's
// application form and a standalone questionnaire are the same object with a
// different purpose, so they are configured in the same place with the same
// editor. A job-linked row links back to its job, which is where a recruiter
// will actually go looking for it.
// =============================================================================
import { Suspense } from "react";
import { SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { listForms } from "@/lib/forms/queries";
import { FormsList } from "./FormsList";

export const metadata = { title: "Forms" };
export const dynamic = "force-dynamic";

async function FormsContent() {
  const membership = await requireMembershipOrRedirect();

  // Viewer is not offered this section in the nav, and the page re-checks
  // independently — the spec's rule is that every page enforces its own access
  // rather than trusting the navigation that led to it.
  if (!hasRole(membership.role, ["owner", "admin", "recruiter"])) {
    return (
      <SettingsShell
        title="Forms"
        description="Application forms and questionnaires."
      >
        <RestrictedPanel what="forms" />
      </SettingsShell>
    );
  }

  const forms = await listForms({ organizationId: membership.organization.id });

  return (
    <SettingsShell
      title="Forms"
      description="Application forms candidates fill in themselves, and questionnaires you send during the process."
    >
      <FormsList forms={forms} canDelete={hasRole(membership.role, ["owner", "admin"])} />
    </SettingsShell>
  );
}

export default function FormsSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <SkeletonRows rows={4} />
        </div>
      }
    >
      <FormsContent />
    </Suspense>
  );
}
