"use client";

import { useState } from "react";
import { Toggle } from "@/components/ui/Toggle";
import { Field, SettingsForm } from "../SettingsForm";
import {
  CAPABILITY_LABELS,
  DATA_COLLECTION_LABELS,
  DECLINE_POLICIES,
  DECLINE_POLICY_LABELS,
  DEFAULT_AI_DISCLOSURE,
  DEFAULT_PRIVACY_NOTICE,
  EXPIRY_ACTIONS,
  EXPIRY_ACTION_LABELS,
  MAX_AI_DISCLOSURE_LENGTH,
  MAX_NOTICE_CONTENT_LENGTH,
  MAX_NOTICE_TITLE_LENGTH,
  METADATA_FIELDS,
  RETENTION_PRESET_DAYS,
  SENSITIVE_CAPABILITIES,
  VIEWER_FORBIDDEN_CAPABILITIES,
  WITHDRAWAL_ACTIONS,
  WITHDRAWAL_ACTION_LABELS,
  type PrivacySettings,
} from "@/lib/privacy/settings";
import { ORG_ROLES, type OrgRole } from "@/lib/types";

/**
 * The §1-§9 configuration form.
 *
 * ONE FORM, ONE SAVE. The nine configurable sections are interdependent —
 * recording gates audio storage, which gates audio retention — so nine separate
 * Save buttons would let an admin leave the object in a state no single section
 * could see was wrong. The design system's explicit-Save rule applies once, to
 * the whole thing.
 *
 * The controls that CANNOT be changed render as disabled with the reason beside
 * them, rather than being hidden. A missing control is a mystery; a disabled one
 * with an explanation is an answer. That mirrors SettingsShell's own note about
 * hiding versus greying out — there the concern was pretending a locked door is
 * not there, and here it is the opposite case: these doors are genuinely locked
 * and saying why is the useful thing.
 */

/** Section wrapper. Purely presentational, kept local to this form. */
function Section({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card mb-4">
      <h3 className="title is-6 mb-2">{title}</h3>
      <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
        {summary}
      </p>
      {children}
    </section>
  );
}

/** A row with a switch on the right and its explanation on the left. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const id = `toggle-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div
      className="mb-4"
      style={{ display: "flex", gap: 16, alignItems: "flex-start", justifyContent: "space-between" }}
    >
      <div style={{ maxWidth: "42rem" }}>
        <label id={id} style={{ fontSize: 14, fontWeight: 600 }}>
          {label}
        </label>
        {hint && (
          <p className="has-text-secondary" style={{ fontSize: 13, marginTop: 2 }}>
            {hint}
          </p>
        )}
        {disabled && disabledReason && (
          <p style={{ fontSize: 13, marginTop: 4, color: "var(--color-text-secondary)" }}>
            <strong>Locked:</strong> {disabledReason}
          </p>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} labelledBy={id} disabled={disabled} />
    </div>
  );
}

function RetentionSelect({
  value,
  onChange,
  label,
  hint,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  hint?: string;
}) {
  // "Custom" is not a stored mode — the model holds days, and Custom is simply a
  // number the preset list does not contain. That keeps every consumer free of a
  // special case.
  const isPreset = value === 0 || (RETENTION_PRESET_DAYS as readonly number[]).includes(value);
  const [custom, setCustom] = useState(!isPreset);

  return (
    <Field label={label} hint={hint}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="select">
          <select
            value={custom ? "custom" : String(value)}
            onChange={(event) => {
              if (event.target.value === "custom") {
                setCustom(true);
                return;
              }
              setCustom(false);
              onChange(Number(event.target.value));
            }}
          >
            {RETENTION_PRESET_DAYS.map((days) => (
              <option key={days} value={days}>
                {days === 365 ? "1 year" : `${days} days`}
              </option>
            ))}
            <option value="custom">Custom</option>
            <option value={0}>Keep until manually deleted</option>
          </select>
        </div>

        {custom && (
          <input
            className="input"
            type="number"
            min={1}
            max={3650}
            style={{ maxWidth: 120 }}
            value={value}
            aria-label={`${label} — custom number of days`}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        )}
        {custom && (
          <span className="has-text-secondary" style={{ fontSize: 13 }}>
            days
          </span>
        )}
      </div>
    </Field>
  );
}

export function PrivacyForm({ initial }: { initial: PrivacySettings }) {
  return (
    <SettingsForm
      initial={initial as unknown as Record<string, unknown>}
      toPayload={(values) => ({ privacy_settings: values })}
      savedMessage="Privacy settings saved."
    >
      {({ values, set }) => {
        // The form state is the PrivacySettings object; these narrow it back.
        const v = values as unknown as PrivacySettings;
        const update = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) =>
          set(key as never, value as never);

        const recordingOn = v.recording.enabled;

        return (
          <>
            {/* ---------------------------------------------------- §1 Recording */}
            <Section
              id="recording"
              title="1. Call recording"
              summary="Whether call audio is captured and kept."
            >
              <ToggleRow
                label="Enable call recording"
                hint="When on, the call is recorded and the recording is linked to the candidate's interview history. When off, no recording is created or kept."
                checked={recordingOn}
                onChange={(next) => {
                  update("recording", { enabled: next });
                  // Turning recording off must also clear the storage checkbox,
                  // or the form would show a contradiction the server then
                  // silently resolves — better to make the consequence visible.
                  if (!next) {
                    update("dataCollection", { ...v.dataCollection, audioRecording: false });
                  }
                }}
              />

              {/*
                The warning the brief asks for. Rendered as a persistent notice
                rather than a one-time confirmation dialog: an admin who enabled
                recording six months ago needs to see this when they come back to
                the page, and a dialog they dismissed once tells them nothing.
              */}
              <div
                style={{
                  border: "1px solid var(--color-border)",
                  borderLeft: "3px solid var(--color-warning)",
                  borderRadius: "var(--card-radius)",
                  padding: 12,
                  fontSize: 13,
                }}
              >
                <strong>Make sure the candidate is informed and appropriate consent is
                obtained before recording</strong>, according to applicable laws and company
                policies. Recording a call without the other party&apos;s consent is unlawful in
                many places.
                <p style={{ marginTop: 8 }}>
                  Every screening call opens by stating that it is automated and may be recorded.
                  That disclosure has no setting and cannot be switched off — the controls below
                  change what is stored and who may see it, not whether the candidate is told.
                </p>
              </div>
            </Section>

            {/* ------------------------------------------------------ §2 Consent */}
            <Section
              id="consent"
              title="2. Candidate consent"
              summary="Whether the agent stops and waits for an explicit yes before continuing."
            >
              <ToggleRow
                label="Require candidate consent before interview"
                hint="When on, the agent asks for confirmation and waits. Silence or an unclear answer ends the call. When off, the candidate is still told the call is automated and recorded, and continuing is treated as consent."
                checked={v.consent.requireExplicitConsent}
                onChange={(next) =>
                  update("consent", { ...v.consent, requireExplicitConsent: next })
                }
                disabled={recordingOn}
                disabledReason={
                  recordingOn
                    ? "Recording is on. Most jurisdictions require every party to agree before a call is recorded, so an explicit confirmation is required while recording is enabled."
                    : undefined
                }
              />

              <div
                style={{
                  background: "var(--color-background)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--card-radius)",
                  padding: 12,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: 6 }}>What the candidate hears</p>
                <p style={{ fontStyle: "italic" }}>
                  &ldquo;Before we begin, please note that this interview may be recorded and
                  processed by AI for recruitment purposes. Do you consent to continue?&rdquo;
                </p>
                <p style={{ marginTop: 8 }}>
                  A refusal ends the call and the interview is marked{" "}
                  <strong>Consent Declined</strong>. It is never dialled again automatically.
                </p>
              </div>

              <Field
                label="If the candidate declines, keep"
                hint="A record that the call happened and was declined is always kept — without it the product could not honour the refusal or stop re-dialling."
              >
                <div className="select">
                  <select
                    value={v.consent.declinePolicy}
                    onChange={(event) =>
                      update("consent", {
                        ...v.consent,
                        declinePolicy: event.target.value as typeof v.consent.declinePolicy,
                      })
                    }
                  >
                    {DECLINE_POLICIES.map((policy) => (
                      <option key={policy} value={policy}>
                        {DECLINE_POLICY_LABELS[policy]}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </Section>

            {/* ------------------------------------------------------- §3 Notice */}
            <Section
              id="notice"
              title="3. Privacy notice"
              summary="The notice shown to candidates about how their interview data is handled."
            >
              <Field label="Privacy notice title">
                <input
                  className="input"
                  type="text"
                  maxLength={MAX_NOTICE_TITLE_LENGTH}
                  value={v.notice.title}
                  onChange={(event) =>
                    update("notice", { ...v.notice, title: event.target.value })
                  }
                />
              </Field>

              <Field
                label="Privacy notice content"
                hint={`Plain text. Up to ${MAX_NOTICE_CONTENT_LENGTH.toLocaleString()} characters.`}
              >
                <textarea
                  className="textarea"
                  rows={6}
                  maxLength={MAX_NOTICE_CONTENT_LENGTH}
                  value={v.notice.content}
                  onChange={(event) =>
                    update("notice", { ...v.notice, content: event.target.value })
                  }
                />
                <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
                  {v.notice.content.length.toLocaleString()} /{" "}
                  {MAX_NOTICE_CONTENT_LENGTH.toLocaleString()}
                </p>
              </Field>

              <button
                type="button"
                className="button is-small"
                onClick={() => update("notice", DEFAULT_PRIVACY_NOTICE)}
              >
                Reset to default
              </button>
            </Section>

            {/* --------------------------------------------- §4 Data collection */}
            <Section
              id="collection"
              title="4. Data collection"
              summary="Which artifacts a screening call produces and keeps."
            >
              {(Object.keys(DATA_COLLECTION_LABELS) as (keyof typeof DATA_COLLECTION_LABELS)[]).map(
                (key) => {
                  const isMetadata = key === "metadata";
                  const isAudio = key === "audioRecording";
                  const locked = isMetadata || (isAudio && !recordingOn);

                  return (
                    <label
                      key={key}
                      style={{
                        display: "block",
                        fontSize: 14,
                        marginBottom: 10,
                        opacity: locked ? 0.75 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        className="mr-2"
                        checked={isMetadata ? true : v.dataCollection[key]}
                        disabled={locked}
                        onChange={(event) =>
                          update("dataCollection", {
                            ...v.dataCollection,
                            [key]: event.target.checked,
                          })
                        }
                      />
                      {DATA_COLLECTION_LABELS[key]}
                      {isMetadata && (
                        <span className="has-text-secondary" style={{ fontSize: 13 }}>
                          {" "}
                          — always stored. It carries the candidate&apos;s consent status, without
                          which a refusal could not be honoured or evidenced.
                        </span>
                      )}
                      {isAudio && !recordingOn && (
                        <span className="has-text-secondary" style={{ fontSize: 13 }}>
                          {" "}
                          — call recording is off, so there is no audio to store.
                        </span>
                      )}
                    </label>
                  );
                }
              )}

              <div
                className="mt-4"
                style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Interview metadata includes
                </p>
                <ul className="has-text-secondary" style={{ fontSize: 13 }}>
                  {METADATA_FIELDS.map((field) => (
                    <li key={field}>· {field}</li>
                  ))}
                </ul>
              </div>
            </Section>

            {/* ---------------------------------------------------- §5 Retention */}
            <Section
              id="retention"
              title="5. Data retention"
              summary="How long each artifact is kept, and what happens when the period ends."
            >
              <RetentionSelect
                label="Default retention period"
                hint="Applies to anything without its own period below."
                value={v.retention.defaultDays}
                onChange={(days) => update("retention", { ...v.retention, defaultDays: days })}
              />

              <Field
                label="When the retention period expires"
                hint="Deleting is irreversible. Manual review is the default because an automatic delete can destroy records an organization is required to keep, and nobody finds out until they need them."
              >
                <div>
                  {EXPIRY_ACTIONS.map((action) => (
                    <label key={action} style={{ display: "block", fontSize: 14, marginBottom: 8 }}>
                      <input
                        type="radio"
                        className="mr-2"
                        name="onExpiry"
                        checked={v.retention.onExpiry === action}
                        onChange={() => update("retention", { ...v.retention, onExpiry: action })}
                      />
                      {EXPIRY_ACTION_LABELS[action]}
                    </label>
                  ))}
                </div>
              </Field>

              <div
                className="mt-4"
                style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}
              >
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  Separate periods per artifact
                </p>

                <RetentionSelect
                  label="Audio recordings"
                  value={v.retention.audioRecordingDays}
                  onChange={(days) =>
                    update("retention", { ...v.retention, audioRecordingDays: days })
                  }
                />
                <RetentionSelect
                  label="Transcripts"
                  value={v.retention.transcriptDays}
                  onChange={(days) => update("retention", { ...v.retention, transcriptDays: days })}
                />
                <RetentionSelect
                  label="AI evaluations"
                  value={v.retention.aiEvaluationDays}
                  onChange={(days) =>
                    update("retention", { ...v.retention, aiEvaluationDays: days })
                  }
                />
              </div>
            </Section>

            {/* -------------------------------------------------- §6 Data rights */}
            <Section
              id="rights"
              title="6. Candidate data rights"
              summary="What a candidate may ask for, and what happens when they withdraw consent."
            >
              <ToggleRow
                label="Allow candidate data deletion requests"
                checked={v.dataRights.allowDeletionRequests}
                onChange={(next) =>
                  update("dataRights", { ...v.dataRights, allowDeletionRequests: next })
                }
              />
              <ToggleRow
                label="Allow candidate data export requests"
                checked={v.dataRights.allowExportRequests}
                onChange={(next) =>
                  update("dataRights", { ...v.dataRights, allowExportRequests: next })
                }
              />
              <ToggleRow
                label="Allow candidate consent withdrawal"
                checked={v.dataRights.allowConsentWithdrawal}
                onChange={(next) =>
                  update("dataRights", { ...v.dataRights, allowConsentWithdrawal: next })
                }
              />

              <div
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--card-radius)",
                  padding: 12,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                In much of the world — the UK and EU under the GDPR, and comparable regimes
                elsewhere — access, erasure and withdrawal are rights a candidate holds whether or
                not this product offers a switch for them. Switching one off does not remove the
                obligation; it removes the product&apos;s help in meeting it.
              </div>

              <Field
                label="If consent is withdrawn"
                hint="Withdrawal always stops future AI interviews. This chooses what else happens."
              >
                <div>
                  {WITHDRAWAL_ACTIONS.map((action) => (
                    <label key={action} style={{ display: "block", fontSize: 14, marginBottom: 8 }}>
                      <input
                        type="radio"
                        className="mr-2"
                        name="onWithdrawal"
                        checked={v.dataRights.onWithdrawal === action}
                        onChange={() =>
                          update("dataRights", { ...v.dataRights, onWithdrawal: action })
                        }
                      />
                      {WITHDRAWAL_ACTION_LABELS[action]}
                    </label>
                  ))}
                </div>
              </Field>
            </Section>

            {/* ------------------------------------------------ §7 AI disclosure */}
            <Section
              id="ai-disclosure"
              title="7. AI processing disclosure"
              summary="An extra statement that responses are analysed automatically."
            >
              <ToggleRow
                label="Enable AI disclosure"
                hint="Said after the opening disclosure and before any question — explaining how answers will be used after they are given is a summary, not a disclosure."
                checked={v.aiDisclosure.enabled}
                onChange={(next) => update("aiDisclosure", { ...v.aiDisclosure, enabled: next })}
              />

              <Field
                label="Disclosure message"
                hint={`Up to ${MAX_AI_DISCLOSURE_LENGTH} characters.`}
              >
                <textarea
                  className="textarea"
                  rows={4}
                  maxLength={MAX_AI_DISCLOSURE_LENGTH}
                  disabled={!v.aiDisclosure.enabled}
                  value={v.aiDisclosure.message}
                  onChange={(event) =>
                    update("aiDisclosure", { ...v.aiDisclosure, message: event.target.value })
                  }
                />
              </Field>

              <button
                type="button"
                className="button is-small"
                onClick={() => update("aiDisclosure", DEFAULT_AI_DISCLOSURE)}
              >
                Reset to default
              </button>

              <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
                Switching this off does not make the call covert. The candidate is still told at
                the start that the call is automated and may be recorded, and is still free to
                refuse.
              </p>
            </Section>

            {/* ------------------------------------------------ §9 Access control */}
            <Section
              id="access"
              title="9. Access control"
              summary="Which roles may see and act on privacy-sensitive interview data."
            >
              <div style={{ overflowX: "auto" }}>
                <table className="table is-fullwidth" style={{ fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th>Capability</th>
                      {ORG_ROLES.map((role) => (
                        <th key={role} style={{ textTransform: "capitalize" }}>
                          {role}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SENSITIVE_CAPABILITIES.map((capability) => (
                      <tr key={capability}>
                        <td>{CAPABILITY_LABELS[capability]}</td>
                        {ORG_ROLES.map((role) => {
                          const forbidden =
                            role === "viewer" &&
                            VIEWER_FORBIDDEN_CAPABILITIES.includes(capability);
                          const granted = v.accessControl[capability].includes(role);

                          return (
                            <td key={role}>
                              <input
                                type="checkbox"
                                checked={granted && !forbidden}
                                disabled={forbidden}
                                aria-label={`${CAPABILITY_LABELS[capability]} — ${role}`}
                                title={
                                  forbidden
                                    ? "A Viewer is the lowest-trust role and cannot be granted this."
                                    : undefined
                                }
                                onChange={(event) => {
                                  const current = v.accessControl[capability];
                                  const next = event.target.checked
                                    ? [...new Set([...current, role])]
                                    : current.filter((r) => r !== role);

                                  update("accessControl", {
                                    ...v.accessControl,
                                    [capability]: next as OrgRole[],
                                  });
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="has-text-secondary" style={{ fontSize: 13 }}>
                A Viewer cannot be granted recording downloads, deletion or candidate export,
                whatever is ticked — the least-trusted seat must not be the most dangerous one.
                Clearing every role from a capability falls back to the default rather than locking
                the organization out of it.
              </p>
            </Section>
          </>
        );
      }}
    </SettingsForm>
  );
}
