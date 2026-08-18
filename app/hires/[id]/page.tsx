import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SkeletonRows } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import { hasRole, requireMembershipOrRedirect } from "@/lib/tenant";
import { listTeamMembers } from "@/lib/jobs/queries";
import { getOnboardingDetail } from "@/lib/onboarding/queries";
import {
  completionCheck,
  ONBOARDING_STATUS_LABELS,
  ONBOARDING_STATUS_TONE,
} from "@/lib/onboarding/documents";
import { Briefcase, Mail, Phone } from "lucide-react";
import { ProgressBar } from "../ProgressBar";
import { DocumentChecklist } from "./DocumentChecklist";
import { OnboardingActions } from "./OnboardingActions";

export const metadata = { title: "Onboarding" };
export const dynamic = "force-dynamic";

async function OnboardingDetailContent({ recordId }: { recordId: string }) {
  const membership = await requireMembershipOrRedirect();

  const [record, members] = await Promise.all([
    getOnboardingDetail({ organizationId: membership.organization.id, recordId }),
    listTeamMembers(membership.organization.id),
  ]);

  // Another organization's record resolves to null, so a guessed id looks
  // exactly like a missing one.
  if (!record) notFound();

  const isAdmin = hasRole(membership.role, ["owner", "admin"]);
  const isStaff = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  /**
   * Mirrors can_manage_onboarding() in the database.
   *
   * A Recruiter manages their own records and unassigned ones — the same rule
   * Module 5 applies to applications, so somebody can pick up work nobody has
   * claimed. The policy is the real boundary; this decides what to render.
   */
  const canManage =
    isStaff &&
    (isAdmin || record.assigned_to === null || record.assigned_to === membership.user_id);

  const completion = completionCheck(record.documents);

  return (
    <>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/hires">Onboarding</Link> / {record.candidate_name}
        </p>

        <h1 className="title is-4 mb-2">
          <Link href={`/candidates/${record.candidate_id}`}>{record.candidate_name}</Link>
          <span className="has-text-secondary" style={{ fontWeight: 400 }}> hired for </span>
          <Link href={`/jobs/${record.job_id}`}>{record.job_title}</Link>
        </h1>

        <div className="meta-line mt-2">
          <span className="meta-line__item">
            <StatusChip
              tone={ONBOARDING_STATUS_TONE[record.status]}
              label={ONBOARDING_STATUS_LABELS[record.status]}
            />
          </span>

          <span className="meta-line__divider" aria-hidden="true" />

          <span className="meta-line__item">
            <Briefcase size={14} aria-hidden="true" />
            Started{" "}
            {new Date(record.started_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: membership.organization.timezone,
            })}
          </span>

          <span className="meta-line__divider" aria-hidden="true" />

          <Link href={`/applications/${record.application_id}`} className="text-link is-primary">
            Open the application
          </Link>
        </div>
      </div>

      <div className="columns">
        <div className="column is-two-thirds">
          {/* The headline number: X of Y REQUIRED documents verified. */}
          <div className="card mb-4">
            <h2 className="title is-5 mb-3">Document progress</h2>
            <ProgressBar progress={record.progress} size="large" />
          </div>

          <DocumentChecklist
            recordId={record.id}
            documents={record.documents}
            canManage={canManage}
            // The spec's default, and the reason the step exists: a recruiter who
            // uploaded a file and then marked it verified has not had it reviewed.
            canVerify={isAdmin}
            locked={record.status === "completed"}
            timeZone={membership.organization.timezone}
          />
        </div>

        <div className="column">
          <div className="card mb-4">
            <h2 className="title is-5">Onboarding</h2>
            <OnboardingActions
              recordId={record.id}
              status={record.status}
              completion={completion}
              canManage={canManage}
              canReassign={isAdmin}
              members={members}
              assignedTo={record.assigned_to}
            />
          </div>

          <div className="card mb-4">
            <h2 className="title is-5">Details</h2>
            <dl style={{ fontSize: 14 }}>
              <Detail label="Assigned to" value={record.assigned_to_name ?? "Unassigned"} />
              <Detail
                label="Completed"
                value={
                  record.completed_at
                    ? new Date(record.completed_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: membership.organization.timezone,
                      })
                    : "—"
                }
              />
            </dl>

            {/*
              The contact details, because the recruiter chasing these documents
              is about to message this person. Shown, never edited here — the
              candidate record owns them, exactly as on the application page.
            */}
            {(record.candidate_email || record.candidate_phone) && (
              <div className="mt-3" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-3)" }}>
                {record.candidate_email && (
                  <p className="is-flex is-align-items-center" style={{ gap: 6, fontSize: 13 }}>
                    <Mail size={13} aria-hidden="true" className="has-text-secondary" />
                    <a href={`mailto:${record.candidate_email}`}>{record.candidate_email}</a>
                  </p>
                )}
                {record.candidate_phone && (
                  <p className="is-flex is-align-items-center mt-1" style={{ gap: 6, fontSize: 13 }}>
                    <Phone size={13} aria-hidden="true" className="has-text-secondary" />
                    {record.candidate_phone}
                  </p>
                )}
              </div>
            )}

            <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
              This checklist was generated from your organization&apos;s document types when the
              application reached Hired. Editing those types in Settings does not change it.
            </p>

            {hasRole(membership.role, ["owner", "admin"]) && (
              <Link
                className="button is-outlined-primary is-small is-fullwidth mt-3"
                href="/settings/onboarding"
              >
                Edit the checklist for future hires
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <dt className="has-text-secondary" style={{ fontSize: 12 }}>
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function OnboardingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <OnboardingDetailContent recordId={id} />
      </Suspense>
    </AppShell>
  );
}
