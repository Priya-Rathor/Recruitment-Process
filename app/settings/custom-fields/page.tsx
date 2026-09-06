import Link from "next/link";
import { hasRole, requireMembershipOrRedirect } from "@/lib/tenant";
import { listDefinitions } from "@/lib/customFields/queries";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { CustomFieldsManager } from "./CustomFieldsManager";

export const metadata = { title: "Custom fields" };
export const dynamic = "force-dynamic";

/**
 * Module 27 — /settings/custom-fields.
 *
 * Loaded server-side and passed down, rather than fetched from the client on
 * mount: the project's standing preference (AGENTS.md §Conventions) and it means
 * the list is on screen in the first paint instead of after a skeleton.
 *
 * VIEWERS GET THE PAGE, NOT THE EDITOR. The brief's §6 makes Viewer read-only
 * for definitions as well as values, and seeing which custom fields exist is a
 * legitimate read — a Viewer looking at a job with a "Visa Sponsorship" field
 * should be able to find out what that field is. RestrictedPanel is reserved for
 * roles that may not see the page at all.
 */
export default async function CustomFieldsSettingsPage() {
  const membership = await requireMembershipOrRedirect();
  const canEdit = hasRole(membership.role, ["owner", "admin"]);

  const definitions = await listDefinitions(membership.organization.id);

  return (
    <SettingsShell
      title="Custom fields"
      description="Extra fields your organization adds to jobs, candidates and applications."
    >
      {!hasRole(membership.role, ["owner", "admin", "recruiter", "viewer"]) ? (
        <RestrictedPanel what="custom fields" />
      ) : (
        <>
          <CustomFieldsManager definitions={definitions} canEdit={canEdit} />

          <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
            Custom fields are added <strong>alongside</strong> the built-in ones — they never
            replace or rename them. Job fields marked{" "}
            <em>Show on public application form</em> also appear on every job&apos;s{" "}
            <Link href="/settings/forms">public application page</Link>, and their answers are
            saved against the application that comes through it.
          </p>
        </>
      )}
    </SettingsShell>
  );
}
