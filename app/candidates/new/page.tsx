import { activeDefinitions } from "@/lib/customFields/queries";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { CandidateForm } from "../CandidateForm";

export const metadata = { title: "Add candidate" };
export const dynamic = "force-dynamic";

export default async function NewCandidatePage() {
  const membership = await requireMembershipOrRedirect();

  // Spec section 9: "Create/edit candidate — Viewer: No". Blocked here and in
  // the API, stated plainly rather than shown as a dead form.
  if (!hasRole(membership.role, ["owner", "admin", "recruiter"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">You can&apos;t add candidates</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Your role is Viewer, which has read-only access. You can still search and view every
            candidate.
          </p>
          <Link className="button" href="/candidates">
            Back to candidates
          </Link>
        </div>
      </AppShell>
    );
  }

  // MODULE 27. No values yet — the candidate does not exist until saved.
  const customFields = await activeDefinitions(membership.organization.id, "candidate");

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/candidates">Candidates</Link> / New
        </p>
        <h1 className="title is-4 mb-1">Add candidate</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          We&apos;ll check for an existing record with the same email or phone before creating this
          one.
        </p>
      </div>

      <CandidateForm mode="create" customFields={customFields} />
    </AppShell>
  );
}
