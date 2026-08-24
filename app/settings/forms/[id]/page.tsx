// =============================================================================
// The field editor. ONE editor, for every kind of form.
//
// A job's application form and a standalone questionnaire open the same screen,
// because they are the same object. The only differences are stated in the page
// rather than built into a second editor: a job form links back to its job, and
// its Email and Resume questions cannot be removed or made optional (the
// database enforces that; see migration 0033).
// =============================================================================
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { AppShell } from "@/components/AppShell";
import { getFormDetail, listFormResponses } from "@/lib/forms/queries";
import { FORM_PURPOSE_LABELS, FORM_STATUS_LABELS } from "@/lib/forms/types";
import { FormEditor } from "./FormEditor";
import { FormSubmissions } from "./FormSubmissions";

export const metadata = { title: "Form" };
export const dynamic = "force-dynamic";

async function FormEditorContent({ formId }: { formId: string }) {
  const membership = await requireMembershipOrRedirect();

  const detail = await getFormDetail({
    organizationId: membership.organization.id,
    formId,
  });
  // A form belonging to another organization resolves to null, so a guessed id
  // is indistinguishable from a missing one.
  if (!detail) notFound();

  const canEdit = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const { form, fields, submissionCount, jobTitle } = detail;

  const { submissions, total } = await listFormResponses({
    organizationId: membership.organization.id,
    formId: form.id,
  });

  return (
    <div className="job-detail">
      <header className="job-header">
        <div className="job-header__text">
          <p className="job-header__crumbs">
            <Link href="/settings/forms">Forms</Link> / {form.name}
          </p>
          <h1 className="job-header__title">{form.name}</h1>
          <div className="job-header__badges">
            <span className="tag is-light">{FORM_PURPOSE_LABELS[form.purpose]}</span>
            <span
              className={`tag ${
                form.status === "published"
                  ? "is-success"
                  : form.status === "disabled"
                    ? "is-warning"
                    : "is-light"
              }`}
            >
              {FORM_STATUS_LABELS[form.status]}
            </span>
            {submissionCount > 0 && (
              <span className="tag is-light">
                {submissionCount} {submissionCount === 1 ? "submission" : "submissions"}
              </span>
            )}
          </div>
        </div>

        {/* A job form is managed FROM THE JOB — that is where the link, the QR
            code and the publish switch live. This page is only the questions. */}
        {form.job_id && (
          <div className="job-header__actions">
            <Link className="button is-quiet" href={`/jobs/${form.job_id}`}>
              Back to {jobTitle ?? "the job"}
            </Link>
          </div>
        )}
      </header>

      {/*
        EDITING A LIVE FORM IS ALLOWED, and worth being explicit about rather
        than blocking. A recruiter who spots a typo in a published question
        should be able to fix it. What changing a question CANNOT do is rewrite
        an answer somebody already gave: answers are keyed on field_key, so a
        renamed question keeps its answers and a removed one leaves them
        readable on the application it came with.
      */}
      {form.status === "published" && submissionCount > 0 && (
        <section className="card is-attention">
          <h2 className="job-card__title is-attention">This form is live and has submissions</h2>
          <p className="job-card__subtitle">
            Changes apply to anyone who opens the link from now on. The {submissionCount}{" "}
            {submissionCount === 1 ? "application" : "applications"} already received keep the
            answers they were given, even to a question you remove here.
          </p>
        </section>
      )}

      <FormEditor
        formId={form.id}
        purpose={form.purpose}
        fields={fields.map((field) => ({
          fieldKey: field.field_key,
          label: field.label,
          helpText: field.help_text,
          fieldType: field.field_type,
          options: field.options,
          required: field.required,
          isStandard: field.is_standard,
        }))}
        canEdit={canEdit}
      />

      <FormSubmissions
        submissions={submissions}
        total={total}
        isJobApplication={form.purpose === "job_application"}
        timeZone={membership.organization.timezone}
      />

      {!canEdit && (
        <p className="job-card__subtitle">Your role has read-only access to forms.</p>
      )}
    </div>
  );
}

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
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
        <FormEditorContent formId={id} />
      </Suspense>
    </AppShell>
  );
}
