"use client";

import { Field, SettingsForm } from "../SettingsForm";
import { MAX_ALLOWED_ATTEMPTS, MIN_ALLOWED_DELAY_MINUTES } from "@/lib/screening/retry";

export function ScreeningForm({
  initial,
}: {
  initial: {
    maxAttempts: number;
    retryDelayMinutes: number;
    language: string;
    recordCalls: boolean;
  };
}) {
  return (
    <SettingsForm
      initial={initial}
      toPayload={(values) => ({
        screening_settings: {
          maxAttempts: Number(values.maxAttempts),
          retryDelayMinutes: Number(values.retryDelayMinutes),
          language: values.language,
          recordCalls: values.recordCalls,
        },
      })}
    >
      {({ values, set }) => (
        <>
          {/*
            These two settings decide how often the product telephones a member
            of the public. The bounds are enforced server-side as well — this
            form is not the boundary.
          */}
          <Field
            label="Maximum call attempts per candidate"
            hint={`A hard cap. Never more than ${MAX_ALLOWED_ATTEMPTS}, whatever is entered — a candidate who doesn't answer is not consenting to be called indefinitely.`}
          >
            <input
              className="input"
              type="number"
              min={1}
              max={MAX_ALLOWED_ATTEMPTS}
              style={{ maxWidth: 120 }}
              value={values.maxAttempts}
              onChange={(event) => set("maxAttempts", Number(event.target.value))}
            />
          </Field>

          <Field
            label="Wait between attempts"
            hint={`Minutes. At least ${MIN_ALLOWED_DELAY_MINUTES}, so a missed call is never followed immediately by another.`}
          >
            <input
              className="input"
              type="number"
              min={MIN_ALLOWED_DELAY_MINUTES}
              style={{ maxWidth: 120 }}
              value={values.retryDelayMinutes}
              onChange={(event) => set("retryDelayMinutes", Number(event.target.value))}
            />
          </Field>

          <Field label="Call language" hint="The language the AI agent speaks.">
            <div className="select">
              <select
                value={values.language}
                onChange={(event) => set("language", event.target.value)}
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="hi-en">Hinglish</option>
              </select>
            </div>
          </Field>

          {/*
            Module 21 moved recording, consent and retention to their own page.

            This control is left in place and pointed at that page rather than
            deleted: it is the setting an admin has had here since Module 8, and
            silently removing a privacy control is a worse outcome than one extra
            hop. The two are the same underlying decision now — the Privacy page
            gates whether audio may be captured at all, so that is the one that
            wins, and this stays as the per-call default beneath it.
          */}
          <Field
            label="Record calls by default"
            hint="Recording is only ever possible after the candidate hears the consent disclosure and continues. Turning this off doesn't remove the disclosure — nothing can."
          >
            <label style={{ fontSize: 14 }}>
              <input
                type="checkbox"
                className="mr-2"
                checked={values.recordCalls}
                onChange={(event) => set("recordCalls", event.target.checked)}
              />
              Record screening calls
            </label>
          </Field>

          <div
            className="mt-4"
            style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}
          >
            <p className="has-text-secondary" style={{ fontSize: 13 }}>
              Every screening call opens by stating that it is automated and may be recorded, and
              treats the candidate continuing as consent. That disclosure has no setting and cannot
              be disabled.
            </p>
            <p className="mt-2" style={{ fontSize: 13 }}>
              Recording, candidate consent, data retention, candidate data rights and who may open
              a recording or transcript are configured under{" "}
              <a href="/settings/privacy">Privacy &amp; consent</a>.
            </p>
          </div>
        </>
      )}
    </SettingsForm>
  );
}
