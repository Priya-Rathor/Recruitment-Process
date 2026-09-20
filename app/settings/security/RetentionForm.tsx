"use client";

import { Field, SettingsForm } from "../SettingsForm";

/**
 * Data retention.
 *
 * 0 means keep indefinitely, and it is the DEFAULT. A product that silently
 * started deleting call transcripts after 90 days would destroy evidence a
 * customer may be legally required to hold, and they would find out only when
 * they needed it. Retention is a decision they make, so the product asks.
 *
 * NOTHING IS DELETED YET. The setting is stored and read; the deletion job is
 * the Privacy & Compliance retrofit. The copy says so rather than implying a
 * cleanup that isn't running.
 */
export function RetentionForm({
  initial,
}: {
  initial: { transcriptRetentionDays: number; archivedCandidateRetentionDays: number };
}) {
  return (
    <SettingsForm
      initial={initial}
      toPayload={(values) => ({
        retention_settings: {
          transcriptRetentionDays: Number(values.transcriptRetentionDays),
          archivedCandidateRetentionDays: Number(values.archivedCandidateRetentionDays),
        },
      })}
    >
      {({ values, set }) => (
        <>
          <Field
            label="Keep call recordings and transcripts for"
            hint="Days. 0 keeps them indefinitely."
          >
            <input
              className="input"
              type="number"
              min={0}
              max={3650}
              style={{ maxWidth: 140 }}
              value={values.transcriptRetentionDays}
              onChange={(event) => set("transcriptRetentionDays", Number(event.target.value))}
            />
          </Field>

          <Field
            label="Keep archived candidate records for"
            hint="Days after archiving. 0 keeps them indefinitely."
          >
            <input
              className="input"
              type="number"
              min={0}
              max={3650}
              style={{ maxWidth: 140 }}
              value={values.archivedCandidateRetentionDays}
              onChange={(event) =>
                set("archivedCandidateRetentionDays", Number(event.target.value))
              }
            />
          </Field>

          <p
            style={{
              fontSize: 13,
              color: "var(--status-attention-text, var(--status-attention-text))",
              marginTop: 8,
            }}
          >
            These periods are recorded but <strong>nothing is deleted yet</strong> — the job that
            enforces them is part of the Privacy &amp; Compliance work that follows this module.
            Set them now so the policy is agreed; don&apos;t rely on them having taken effect.
          </p>
        </>
      )}
    </SettingsForm>
  );
}
