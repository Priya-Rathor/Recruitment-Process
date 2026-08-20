"use client";

import Link from "next/link";
import { Field, SettingsForm } from "../SettingsForm";
import { APPLICATION_STAGES, STAGE_LABELS } from "@/lib/applications/stages";
import { SEND_CHANNELS, type SendChannel } from "@/lib/communications/templates";

export function RecruitmentForm({
  initial,
  members,
  reminderTemplateActive,
}: {
  initial: {
    currency: string;
    default_recruiter_id: string | null;
    default_application_stage: string;
    default_interview_duration_minutes: number;
    /** Module 15's interview reminder. See CommunicationSettings. */
    interview_reminder_hours: number;
    interview_reminder_channels: SendChannel[];
  };
  members: { id: string; name: string }[];
  /** So the reminder section can say plainly whether it will send anything. */
  reminderTemplateActive: boolean;
}) {
  return (
    <SettingsForm
      initial={initial}
      toPayload={(values) => ({
        currency: values.currency,
        default_recruiter_id: values.default_recruiter_id,
        default_application_stage: values.default_application_stage,
        default_interview_duration_minutes: Number(values.default_interview_duration_minutes),
        communication_settings: {
          interviewReminderHours: Number(values.interview_reminder_hours),
          interviewReminderChannels: values.interview_reminder_channels,
        },
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

          {/*
            THE INTERVIEW REMINDER — the one reminder config in the product.
            Module 11 never built one, so rather than stand up a second reminder
            system this extends the existing dispatcher; see CommunicationSettings
            in lib/settings/queries.ts.
          */}
          <Field
            label="Interview reminder"
            hint="Hours before a scheduled interview that the candidate is reminded. 0 switches it off."
          >
            <input
              className="input"
              type="number"
              min={0}
              max={168}
              style={{ maxWidth: 120 }}
              value={values.interview_reminder_hours}
              onChange={(event) =>
                set("interview_reminder_hours", Number(event.target.value))
              }
            />
          </Field>

          <Field
            label="Reminder channels"
            hint="Choose one or both. Unchecking both switches the reminder off, the same as setting 0 hours."
          >
            {SEND_CHANNELS.map((channel) => {
              const checked = values.interview_reminder_channels.includes(channel);
              return (
                <label
                  key={channel}
                  className="is-block mb-1"
                  style={{ fontSize: 14, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={checked}
                    onChange={() =>
                      set(
                        "interview_reminder_channels",
                        checked
                          ? values.interview_reminder_channels.filter(
                              (existing) => existing !== channel
                            )
                          : [...values.interview_reminder_channels, channel]
                      )
                    }
                  />
                  {channel === "email" ? "Email" : "WhatsApp"}
                </label>
              );
            })}

            {/*
              Said here, not discovered later. These two settings decide the WHEN
              and the WHERE; the words come from the template library, and with no
              active template the reminder sends nothing however this is set.
            */}
            {!reminderTemplateActive && (
              <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
                No interview reminder template is switched on, so no reminder will be sent whatever
                you set here.{" "}
                <Link className="text-link" href="/settings/templates">
                  Message templates
                </Link>
              </p>
            )}

            {/*
              The product has no scheduler — the same limitation Module 15 already
              records for feedback reminders. Saying so is the difference between a
              setting and a promise.
            */}
            <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
              Reminders go out when somebody dispatches them from the notifications page — this
              product has no background scheduler yet, so they are not sent at a fixed hour.
            </p>
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
