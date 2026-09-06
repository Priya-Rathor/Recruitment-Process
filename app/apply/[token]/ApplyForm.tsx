"use client";

// =============================================================================
// The form itself.
//
// CLIENT-SIDE VALIDATION HERE IS A COURTESY, NOT A CONTROL. It exists so an
// applicant on a phone finds out about a mistyped email before they lose the
// scroll position, and it calls THE SAME validateAnswers() the server calls —
// one set of rules, imported by both, so the page can never accept something
// the endpoint will refuse or vice versa. The endpoint re-runs it against the
// field definitions in the database, which is the check that actually counts.
//
// STATE IS KEYED ON field_key, mirroring how the answer is stored, so nothing
// has to be translated between what is typed and what is saved.
//
// WHAT HAPPENS ON FAILURE MATTERS MORE THAN WHAT HAPPENS ON SUCCESS. Somebody
// has just typed for five minutes on a phone: every error path keeps every
// answer, scrolls to the first problem, and never navigates away.
// =============================================================================

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { FormError } from "@/components/states";
// Module 27 moved this out of here so the custom-field sections render the same
// controls. See the header of components/FieldInput.tsx.
import { FieldInput } from "@/components/FieldInput";
import { validateAnswers, type AnswerErrors } from "@/lib/forms/validation";
import type { PublicField } from "@/lib/forms/public";

type Values = Record<string, string | string[] | boolean>;

export function ApplyForm({
  token,
  fields,
  privacyNotice,
}: {
  token: string;
  fields: PublicField[];
  privacyNotice: { title: string; content: string };
}) {
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<AnswerErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const resumeField = fields.find((field) => field.fieldType === "file_upload") ?? null;

  function set(key: string, value: string | string[] | boolean) {
    setValues((current) => ({ ...current, [key]: value }));
    // The error clears as soon as they start fixing it, rather than persisting
    // until the next submit — which would read as "still wrong" while they type.
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /** Moves focus to the first field with a problem, so nobody hunts for it. */
  function focusFirstError(nextErrors: AnswerErrors) {
    const firstKey = fields.find((field) => nextErrors[field.fieldKey])?.fieldKey;
    if (!firstKey) return;
    const element = formRef.current?.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.querySelector<HTMLElement>("input, textarea, select")?.focus();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);

    const file = fileInput.current?.files?.[0] ?? null;

    // The same function the server runs. `uploadedFileKeys` is how "was a file
    // attached?" is answered — the file is never in the values object.
    const check = validateAnswers({
      fields: fields.map((field) => ({
        field_key: field.fieldKey,
        label: field.label,
        field_type: field.fieldType,
        options: field.options,
        required: field.required,
      })),
      raw: values,
      uploadedFileKeys: file && resumeField ? [resumeField.fieldKey] : [],
    });

    if (!check.ok) {
      setErrors(check.errors);
      focusFirstError(check.errors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      const body = new FormData();
      for (const field of fields) {
        if (field.fieldType === "file_upload") continue;
        const value = values[field.fieldKey];
        if (Array.isArray(value)) {
          // One entry per box ticked — the shape an HTML form posts, and what
          // the route's getAll() expects.
          for (const item of value) body.append(field.fieldKey, item);
        } else if (typeof value === "boolean") {
          body.append(field.fieldKey, value ? "yes" : "no");
        } else if (value !== undefined && value !== "") {
          body.append(field.fieldKey, value);
        }
      }
      if (file && resumeField) body.append(resumeField.fieldKey, file);

      const response = await fetch(`/api/apply/${token}/submit`, { method: "POST", body });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const fieldErrors = (payload?.field_errors ?? null) as AnswerErrors | null;
        if (fieldErrors && Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
          focusFirstError(fieldErrors);
        }
        setFormError(payload?.error ?? "Your application couldn't be submitted. Please try again.");
        return;
      }

      setDone(payload?.data?.message ?? "Thank you! Your application has been submitted.");
    } catch {
      // A dropped connection on a phone. Everything they typed is still in
      // state, so "try again" is a real instruction.
      setFormError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section className="card apply-done">
        <p className="apply-done__icon" aria-hidden="true">
          <CheckCircle2 size={32} />
        </p>
        <h2 className="apply-done__title">Application submitted</h2>
        <p className="apply-done__text">{done}</p>
      </section>
    );
  }

  return (
    <form ref={formRef} className="card apply-form" onSubmit={submit} noValidate>
      <h2 className="apply-form__title">Apply for this position</h2>

      {fields.map((field) => (
        <div key={field.fieldKey} className="field" data-field={field.fieldKey}>
          <label className="label apply-label" htmlFor={`f-${field.fieldKey}`}>
            {field.label}
            {field.required && (
              <span className="apply-label__required" aria-hidden="true">
                *
              </span>
            )}
          </label>

          <FieldInput
            field={field}
            value={values[field.fieldKey]}
            onChange={(value) => set(field.fieldKey, value)}
            fileInput={fileInput}
            fileName={fileName}
            onFile={setFileName}
          />

          {field.helpText && <p className="help has-text-secondary">{field.helpText}</p>}
          {errors[field.fieldKey] && (
            <p className="help is-danger apply-error" role="alert">
              {errors[field.fieldKey]}
            </p>
          )}
        </div>
      ))}

      {/*
        THE PRIVACY DISCLOSURE. This is the first point of collection from the
        applicant, and per AGENTS.md a consent disclosure cannot be switched off —
        so it is rendered unconditionally, above the button, from the
        organization's own Module 22 notice.
      */}
      <section className="apply-privacy">
        <h3 className="apply-privacy__title">
          <ShieldCheck size={14} aria-hidden="true" />
          {privacyNotice.title}
        </h3>
        <p className="apply-privacy__text">{privacyNotice.content}</p>
      </section>

      <FormError message={formError} />

      <button className="button is-primary apply-submit" type="submit" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 size={16} className="apply-spin" aria-hidden="true" />
            Submitting…
          </>
        ) : (
          "Submit application"
        )}
      </button>

      <p className="apply-form__foot">
        Your answers go straight to the hiring team. You will not be asked to create an account.
      </p>
    </form>
  );
}

function initialValues(fields: PublicField[]): Values {
  const values: Values = {};
  for (const field of fields) {
    if (field.fieldType === "checkbox") values[field.fieldKey] = [];
    else if (field.fieldType === "yes_no") values[field.fieldKey] = "";
    else values[field.fieldKey] = "";
  }
  return values;
}
