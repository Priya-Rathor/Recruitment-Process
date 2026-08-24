"use client";

// =============================================================================
// The forms list, plus "New form".
//
// A CLIENT COMPONENT ONLY BECAUSE IT WRITES. The list itself is server-rendered
// data passed in; this adds the create dialog and the delete action, then calls
// router.refresh() so the page re-reads rather than this component keeping its
// own copy of the truth.
//
// DELETING IS REFUSED WHEN SUBMISSIONS EXIST — the API is what enforces it (the
// rows cascade), and the button is absent here rather than greyed out, per the
// design system's rule about actions a role or a state cannot take.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2 } from "lucide-react";
import { EmptyState, FormError } from "@/components/states";
import { FORM_PURPOSE_LABELS, FORM_STATUS_LABELS, type FormSummary } from "@/lib/forms/types";

const STATUS_TONE: Record<string, string> = {
  draft: "is-light",
  published: "is-success",
  disabled: "is-warning",
};

export function FormsList({
  forms,
  canDelete,
}: {
  forms: FormSummary[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Give the form a name.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, purpose: "general" }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not create the form.");
        return;
      }

      // Straight into the editor: a form with no questions is not useful yet,
      // and the next thing anybody wants to do is add one.
      router.push(`/settings/forms/${payload.data.id}`);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(form: FormSummary) {
    if (
      !window.confirm(
        `Delete "${form.name}"? Its questions go with it. This cannot be undone.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/forms/${form.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not delete the form.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FormError message={error} />

      <div className="card mb-4">
        {creating ? (
          <div className="field">
            <label className="label" htmlFor="form-name">
              What is this form for?
            </label>
            <input
              id="form-name"
              className="input"
              type="text"
              maxLength={200}
              autoFocus
              placeholder="Pre-interview availability"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="help has-text-secondary">
              A standalone form starts empty — you add the questions yourself. A job&apos;s
              application form is created from the job, with the standard questions already in it.
            </p>
            <div className="job-card__foot">
              <button
                className="button is-quiet"
                type="button"
                onClick={() => {
                  setCreating(false);
                  setName("");
                  setError(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="button is-primary" type="button" onClick={create} disabled={busy}>
                Create and add questions
              </button>
            </div>
          </div>
        ) : (
          <button
            className="button is-primary"
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus size={14} aria-hidden="true" />
            New form
          </button>
        )}
      </div>

      {forms.length === 0 ? (
        <EmptyState
          headline="No forms yet"
          message="Every job you create gets a draft application form automatically — open a job to publish its link. Standalone forms, for questionnaires you send during the process, are created here."
        />
      ) : (
        <div className="card">
          <ul className="job-rows">
            {forms.map((form) => (
              <li key={form.id} className="job-rows__row is-split">
                <div>
                  <Link href={`/settings/forms/${form.id}`} className="job-rows__name">
                    <FileText size={14} aria-hidden="true" /> {form.name}
                  </Link>
                  <p className="job-rows__meta">
                    {FORM_PURPOSE_LABELS[form.purpose]}
                    {form.jobTitle ? ` · ${form.jobTitle}` : ""} · {form.fieldCount}{" "}
                    {form.fieldCount === 1 ? "question" : "questions"}
                    {form.submissionCount > 0
                      ? ` · ${form.submissionCount} ${
                          form.submissionCount === 1 ? "submission" : "submissions"
                        }`
                      : ""}
                  </p>
                </div>
                <div className="job-rows__end">
                  <span className={`tag ${STATUS_TONE[form.status] ?? "is-light"}`}>
                    {FORM_STATUS_LABELS[form.status]}
                  </span>
                  {/* Absent, not disabled, when it cannot be done — a delete
                      that erases somebody's submitted answers is not offered. */}
                  {canDelete && form.submissionCount === 0 && (
                    <button
                      className="button is-small is-danger-soft"
                      type="button"
                      onClick={() => remove(form)}
                      disabled={busy}
                      aria-label={`Delete ${form.name}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
