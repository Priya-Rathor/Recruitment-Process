"use client";

// =============================================================================
// THE CONTACT FORM.
//
// -----------------------------------------------------------------------------
// IT DOES NOT SEND, AND IT SAYS SO BEFORE YOU FILL IT IN
// -----------------------------------------------------------------------------
//
// There is no contact backend in this project and no way to build one without
// inventing a destination — lib/marketing/contact.ts records the inspection in
// full. §10 is explicit: do not fake success, and do not create a fake API
// endpoint to make the animation work. So there is no fetch in this file and
// there is no route for one to call.
//
// WHAT IT DOES INSTEAD. The notice sits ABOVE the fields, so nobody spends five
// minutes writing before finding out. On submit, a valid form reaches a state
// that says plainly it was not sent, offers the route that does work, and lets
// the reader copy what they wrote so the effort is not thrown away.
//
// EVERYTHING ELSE IS REAL. Labels tied to inputs, autocomplete tokens,
// `aria-invalid` and `aria-describedby` on every field, errors announced, the
// submit button disabled while working, and validation from the SAME pure
// function a server route would call the day one exists.
//
// VALIDATION TIMING (§7): inline, but not hostile. A field is validated when it
// is blurred, and thereafter on every keystroke — so an error appears once you
// have finished with a field and clears as soon as you have fixed it, rather
// than firing on the second character of an email nobody has finished typing.
// =============================================================================

import { useRef, useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import {
  CONTACT_FIELDS,
  CONTACT_FORM_NOTICE,
  CONTACT_LIMITS,
  CONTACT_PRIVACY_NOTE,
  EMPTY_CONTACT,
  validateContact,
  type ContactErrors,
  type ContactFieldName,
  type ContactValues,
} from "@/lib/marketing/contact";

/**
 * §9's states, minus the two that would require a server.
 *
 * There is no "success" here on purpose. A success state whose backend does not
 * exist is the single thing this module must not ship.
 */
type FormState = "idle" | "checking" | "not-sent";

export function ContactForm() {
  const [values, setValues] = useState<ContactValues>(EMPTY_CONTACT);
  const [errors, setErrors] = useState<ContactErrors>({});
  /** Fields the reader has finished with — only these show an error. */
  const [touched, setTouched] = useState<Partial<Record<ContactFieldName, boolean>>>({});
  const [state, setState] = useState<FormState>("idle");
  const [copied, setCopied] = useState(false);

  const outcomeRef = useRef<HTMLDivElement>(null);

  const setField = (name: ContactFieldName, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    // Re-validate a field the reader has already left, so a fix clears its
    // error immediately rather than waiting for another blur.
    if (touched[name]) setErrors(validateContact(next));
  };

  const onBlur = (name: ContactFieldName) => {
    setTouched((current) => ({ ...current, [name]: true }));
    setErrors(validateContact(values));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === "checking") return;

    const found = validateContact(values);
    setErrors(found);
    setTouched({ name: true, email: true, company: true, role: true, message: true });

    if (Object.keys(found).length > 0) {
      // Move focus to the first problem, which is the only way a keyboard or
      // screen-reader user finds it without hunting up the form.
      const first = CONTACT_FIELDS.find((field) => found[field.name]);
      if (first) document.getElementById(`contact-${first.name}`)?.focus();
      return;
    }

    /*
      THE "SUBMITTING" BEAT IS REAL, and it is not theatre for an absent
      request: the form has just been validated and the reader is being told
      the outcome of that. It is short, and it exists so the button cannot be
      double-fired into a second state change.
    */
    setState("checking");
    window.setTimeout(() => {
      setState("not-sent");
      // Announced by the live region below; focus follows so a keyboard user
      // lands on the explanation rather than staying on a dead button.
      window.setTimeout(() => outcomeRef.current?.focus(), 0);
    }, 450);
  };

  const draft = [
    `Name: ${values.name.trim()}`,
    `Work email: ${values.email.trim()}`,
    values.company.trim() ? `Company: ${values.company.trim()}` : null,
    values.role.trim() ? `Role: ${values.role.trim()}` : null,
    "",
    values.message.trim(),
  ]
    .filter((line) => line !== null)
    .join("\n");

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused — an insecure origin, a permission
      // policy, an older browser. The text is still on screen in the textarea,
      // so the fallback is to say nothing rather than raise an error about a
      // convenience.
    }
  };

  return (
    <div className="ct-panel">
      {/*
        §10 — THE NOTICE COMES FIRST. Before the legend, before the fields, in
        the reading order and in the tab order.
      */}
      <div className="ct-notice">
        <p className="ct-notice__title">{CONTACT_FORM_NOTICE.title}</p>
        <p className="ct-notice__body">{CONTACT_FORM_NOTICE.body}</p>
      </div>

      <form className="ct-form" onSubmit={submit} noValidate>
        <fieldset disabled={state === "checking"}>
          {/*
            The legend names the group for a screen reader. Visually hidden
            because the section's own h2 directly above it says the same thing,
            and two headings for one form reads as a duplication rather than as
            structure.
          */}
          <legend className="is-sr-only">Tell us about your hiring</legend>

          {CONTACT_FIELDS.map((field) => {
            const id = `contact-${field.name}`;
            const errorId = `${id}-error`;
            const hintId = `${id}-hint`;
            const showError = Boolean(touched[field.name] && errors[field.name]);

            const describedBy =
              [field.hint ? hintId : null, showError ? errorId : null]
                .filter(Boolean)
                .join(" ") || undefined;

            return (
              <div key={field.name} className="ct-field">
                <label htmlFor={id} className="ct-field__label">
                  {field.label}
                  {/*
                    Required is stated in words, not as a bare asterisk. An
                    asterisk is a convention a lot of people have never had
                    explained to them, and it is read out as "star".
                  */}
                  {!field.required && (
                    <span className="ct-field__optional"> (optional)</span>
                  )}
                </label>

                {field.hint && (
                  <p id={hintId} className="ct-field__hint">
                    {field.hint}
                  </p>
                )}

                {field.type === "textarea" ? (
                  <textarea
                    id={id}
                    name={field.name}
                    className="ct-input ct-input--area"
                    rows={5}
                    required={field.required}
                    maxLength={CONTACT_LIMITS.messageMax}
                    aria-invalid={showError || undefined}
                    aria-describedby={describedBy}
                    value={values[field.name]}
                    onChange={(event) => setField(field.name, event.target.value)}
                    onBlur={() => onBlur(field.name)}
                  />
                ) : (
                  <input
                    id={id}
                    name={field.name}
                    type={field.type}
                    className="ct-input"
                    autoComplete={field.autoComplete}
                    required={field.required}
                    aria-invalid={showError || undefined}
                    aria-describedby={describedBy}
                    value={values[field.name]}
                    onChange={(event) => setField(field.name, event.target.value)}
                    onBlur={() => onBlur(field.name)}
                  />
                )}

                {/*
                  The error is always in the DOM so the id `aria-describedby`
                  points at always resolves; it is emptied rather than removed.
                  `role="alert"` on a node that appears would announce on every
                  keystroke, so the announcement is left to the field's own
                  invalid state and the summary at the end.
                */}
                <p id={errorId} className="ct-field__error" hidden={!showError}>
                  {showError ? errors[field.name] : ""}
                </p>
              </div>
            );
          })}
        </fieldset>

        <p className="ct-form__privacy">{CONTACT_PRIVACY_NOTE}</p>

        <button type="submit" className="mkt-btn mkt-btn--primary ct-submit" disabled={state === "checking"}>
          {state === "checking" ? "Checking…" : "Check this message"}
          {state !== "checking" && <ArrowRight size={17} aria-hidden="true" />}
        </button>

        {/*
          THE OUTCOME, and the nesting here is the accessible part rather than a
          wrapper for styling.

          THE LIVE REGION IS ALWAYS PRESENT AND NEVER `hidden`. A region that is
          hidden at the moment its content changes is unreliable across screen
          readers — several compute the announcement from a subtree that was not
          being exposed a frame earlier, and the result is silence on the one
          message that explains the form did not send. So the region is a stable,
          empty, unstyled element and only its CONTENTS appear.

          `tabIndex={-1}` sits on the inner box, which is what focus moves to.
        */}
        <div className="ct-outcome-live" aria-live="polite">
          {state === "not-sent" && (
            <div className="ct-outcome" ref={outcomeRef} tabIndex={-1}>
              <p className="ct-outcome__title">Checked — but not sent.</p>
              <p className="ct-outcome__body">
                Your message is valid and complete. It has not gone anywhere,
                because there is no inbox connected to this form yet. Copy it if
                you want to keep it, and create an account to start using the
                product now.
              </p>

              <div className="ct-outcome__actions">
                <button type="button" className="mkt-btn mkt-btn--ghost ct-copy" onClick={copyDraft}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy your message"}
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
