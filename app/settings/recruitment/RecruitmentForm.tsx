"use client";

import { Field, SettingsForm } from "../SettingsForm";
import { APPLICATION_STAGES, STAGE_LABELS } from "@/lib/applications/stages";

export function RecruitmentForm({
  initial,
  members,
}: {
  initial: {
    currency: string;
    default_recruiter_id: string | null;
    default_application_stage: string;
    default_interview_duration_minutes: number;
  };
  members: { id: string; name: string }[];
}) {
  return (
    <SettingsForm
      initial={initial}
      toPayload={(values) => ({
        currency: values.currency,
        default_recruiter_id: values.default_recruiter_id,
        default_application_stage: values.default_application_stage,
        default_interview_duration_minutes: Number(values.default_interview_duration_minutes),
      })}
    >
      {({ values, set }) => (
        <>
          <Field
            label="Default recruiter"
            hint="Assigned to new applications when nobody is chosen. Leaving it unset assigns the person who created the application."
          >
            <div className="select is-fullwidth">
              <select
                value={values.default_recruiter_id ?? ""}
                onChange={(event) => set("default_recruiter_id", event.target.value || null)}
              >
                <option value="">Whoever creates the application</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <Field
            label="Default stage for new applications"
            hint="Most teams start at New. A referral-heavy team might start further along."
          >
            <div className="select is-fullwidth">
              <select
                value={values.default_application_stage}
                onChange={(event) => set("default_application_stage", event.target.value)}
              >
                {APPLICATION_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Default interview duration" hint="Minutes. Between 5 and 480.">
            <input
              className="input"
              type="number"
              min={5}
              max={480}
              value={values.default_interview_duration_minutes}
              onChange={(event) =>
                set("default_interview_duration_minutes", Number(event.target.value))
              }
            />
          </Field>

          <Field
            label="Currency"
            hint="Three-letter code. Used when displaying salary bands and expected CTC."
          >
            <input
              className="input"
              value={values.currency}
              maxLength={3}
              style={{ maxWidth: 120, textTransform: "uppercase" }}
              onChange={(event) => set("currency", event.target.value.toUpperCase())}
            />
          </Field>
        </>
      )}
    </SettingsForm>
  );
}
