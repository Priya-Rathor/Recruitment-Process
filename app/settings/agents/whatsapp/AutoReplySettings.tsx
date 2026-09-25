"use client";

// =============================================================================
// The auto-reply agent's configuration screen.
//
// Three sections, in the order an admin needs them:
//
//   1. THE MASTER SWITCH, first and unmissable. It is the same switch as the one
//      in the inbox — one organization-level boolean, two places to reach it —
//      because the person configuring the agent and the person stopping it are
//      not always the same person or in the same hurry.
//   2. THE ORGANIZATION DEFAULT — what the agent does everywhere unless a job
//      says otherwise.
//   3. PER-JOB OVERRIDES, with the precedence table Module 24's Default Call
//      Data established: Field | Org default | This job | Effective. Built by
//      autoReplyPrecedenceRows(), the same pure function the agent itself calls,
//      so the preview cannot drift from the behaviour.
//
// EXPLICIT SAVE, never auto-save. The design system requires it for config edits
// and it matters more here than elsewhere: every field on this form changes what
// an unattended AI says to real people, and a silent save on blur would commit a
// half-typed instruction.
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { EmptyState, FormError } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  autoReplyPrecedenceRows,
  AUTO_REPLY_LIMITS,
  type AutoReplyConfig,
  type AutoReplyTiming,
} from "@/lib/autoReply/config";
import type { AutoReplySettingsView } from "@/lib/autoReply/queries";

type Editing =
  | { scope: "organization" }
  | { scope: "job"; jobId: string; jobTitle: string | null }
  | null;

export function AutoReplySettings({
  initial,
  whatsappConnected,
  aiConfigured,
}: {
  initial: AutoReplySettingsView;
  whatsappConnected: boolean;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [masterEnabled, setMasterEnabled] = useState(initial.masterEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [addingJobId, setAddingJobId] = useState("");

  async function toggleMaster(next: boolean) {
    setBusy(true);
    setError(null);

    // Optimistic, then reconciled by router.refresh(). The switch has to feel
    // instant: somebody pressing it OFF is reacting to something the agent just
    // said, and a spinner between the decision and the effect is the wrong
    // experience for a kill switch.
    setMasterEnabled(next);

    try {
      const response = await fetch("/api/settings/auto-reply", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master_enabled: next }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Couldn't change that setting.");
        setMasterEnabled(!next);
        return;
      }

      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was changed.");
      setMasterEnabled(!next);
    } finally {
      setBusy(false);
    }
  }

  async function removeOverride(configId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/settings/auto-reply?id=${configId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Couldn't remove that override.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (editing !== null) {
    return (
      <ConfigForm
        scope={editing}
        existing={
          editing.scope === "organization"
            ? initial.orgConfig
            : (initial.jobOverrides.find(
                (override) => override.config.job_id === editing.jobId
              )?.config ?? null)
        }
        onDone={() => {
          setEditing(null);
          router.refresh();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      <FormError message={error} />

      {/* ---- 1. The master switch --------------------------------------- */}
      <div className="card mb-4">
        <div
          className="is-flex is-justify-content-space-between is-align-items-flex-start"
          style={{ gap: "1rem", flexWrap: "wrap" }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 className="title is-5 mb-1">
              <Bot size={17} aria-hidden="true" /> Auto-reply agent
            </h2>
            <p className="has-text-secondary" style={{ fontSize: 13, margin: 0 }}>
              {masterEnabled
                ? "The agent is answering candidates. Everything it sends is labelled in the thread and listed under Recent auto-replies in Messages."
                : "The agent is off. Candidate messages wait in Messages for a person, exactly as they did before this feature existed."}
            </p>
          </div>

          <Toggle
            checked={masterEnabled}
            disabled={busy}
            onChange={(next) => void toggleMaster(next)}
            label={masterEnabled ? "On" : "Off"}
          />
        </div>

        {masterEnabled && (!whatsappConnected || !aiConfigured) && (
          <p
            className="mt-3"
            style={{ fontSize: 13, color: "var(--color-warning)", marginBottom: 0 }}
          >
            <TriangleAlert size={14} aria-hidden="true" /> Switched on, but it cannot run — see
            above. Nothing is being sent.
          </p>
        )}

        {/*
          Said where the switch is, not buried in a help page. An admin turning
          this on is agreeing to something specific, and a sentence they read
          while doing it is worth more than a paragraph they do not.
        */}
        <p className="has-text-secondary mt-3" style={{ fontSize: 12, marginBottom: 0 }}>
          The agent only ever sends one WhatsApp reply. It never changes an application, moves a
          stage, schedules anything, or emails anybody. When it isn&apos;t confident — or when a
          candidate raises pay, a decision, a visa, or anything sensitive — it sends a short holding
          message and flags the conversation for a person instead of guessing.
        </p>
      </div>

      {/* ---- 2. The organization default -------------------------------- */}
      <div className="card mb-4">
        <div
          className="is-flex is-justify-content-space-between is-align-items-center mb-3"
          style={{ gap: "0.75rem", flexWrap: "wrap" }}
        >
          <h2 className="title is-5 mb-0">Organization default</h2>
          <Button
            variant="outline"
            size="small"
            icon={Pencil}
            onClick={() => setEditing({ scope: "organization" })}
          >
            {initial.orgConfig ? "Edit" : "Set up"}
          </Button>
        </div>

        {initial.orgConfig ? (
          <ConfigSummary config={initial.orgConfig} />
        ) : (
          <EmptyState
            compact
            headline="No default yet"
            message="Until a default is set, the agent answers nobody — even with the switch on. A job override can still enable it for one job."
            icon={Bot}
          />
        )}
      </div>

      {/* ---- 3. Per-job overrides --------------------------------------- */}
      <div className="card mb-4">
        <h2 className="title is-5 mb-1">Per-job overrides</h2>
        <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
          A job&apos;s override replaces the default entirely — including when it is switched{" "}
          <strong>off</strong>, which is how you stop the agent on one sensitive role while leaving
          it on everywhere else. Remove an override to go back to the default.
        </p>

        {initial.jobOverrides.length === 0 ? (
          <EmptyState
            compact
            headline="No overrides"
            message="Every job uses the organization default."
            icon={Bot}
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table is-fullwidth" style={{ fontSize: 14 }}>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Auto-reply</th>
                  <th>Timing</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {initial.jobOverrides.map(({ config, jobTitle }) => (
                  <tr key={config.id}>
                    <td>{jobTitle ?? <em className="has-text-secondary">Archived job</em>}</td>
                    <td>
                      <StatusChip
                        tone={config.enabled ? "success" : "neutral"}
                        label={config.enabled ? "On" : "Off"}
                      />
                    </td>
                    <td>
                      {config.response_timing === "immediate"
                        ? "Immediate"
                        : `After ${config.delay_minutes} min`}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="button is-small"
                        disabled={busy}
                        onClick={() =>
                          setEditing({
                            scope: "job",
                            jobId: config.job_id as string,
                            jobTitle,
                          })
                        }
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>{" "}
                      <button
                        type="button"
                        className="button is-small"
                        disabled={busy}
                        aria-label={`Remove the override for ${jobTitle ?? "this job"}`}
                        onClick={() => void removeOverride(config.id)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {initial.availableJobs.length > 0 && (
          <div className="is-flex mt-3" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <div className="select is-small">
              <select
                value={addingJobId}
                onChange={(event) => setAddingJobId(event.target.value)}
                aria-label="Job to override"
              >
                <option value="">Choose a job…</option>
                {initial.availableJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              size="small"
              icon={Plus}
              disabled={addingJobId === ""}
              onClick={() => {
                const job = initial.availableJobs.find((item) => item.id === addingJobId);
                if (job) setEditing({ scope: "job", jobId: job.id, jobTitle: job.title });
              }}
            >
              Add job override
            </Button>
          </div>
        )}
      </div>

      {/* ---- The precedence preview ------------------------------------- */}
      {initial.jobOverrides.length > 0 && (
        <PrecedencePreview
          masterEnabled={masterEnabled}
          orgConfig={initial.orgConfig}
          overrides={initial.jobOverrides}
        />
      )}
    </>
  );
}

function ConfigSummary({ config }: { config: AutoReplyConfig }) {
  return (
    <dl style={{ fontSize: 14, display: "grid", gap: "0.5rem" }}>
      <Row label="Auto-reply">
        <StatusChip
          tone={config.enabled ? "success" : "neutral"}
          label={config.enabled ? "On" : "Off"}
        />
      </Row>
      <Row label="Timing">
        {config.response_timing === "immediate"
          ? "Immediate"
          : `After ${config.delay_minutes} minutes`}
      </Row>
      <Row label="Tone">
        {config.tone_instructions ?? <span className="has-text-secondary">Not set</span>}
      </Row>
      <Row label="Context rules">
        {config.context_instructions ?? <span className="has-text-secondary">Not set</span>}
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="is-flex" style={{ gap: "0.75rem", alignItems: "baseline" }}>
      <dt
        className="has-text-secondary"
        style={{ fontSize: 13, minWidth: 120, flexShrink: 0 }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, minWidth: 0 }}>{children}</dd>
    </div>
  );
}

/**
 * The Field | Org default | This job | Effective table, one block per override.
 *
 * Read-only, and built from autoReplyPrecedenceRows() — the SAME function the
 * agent calls to decide what to do. The Voice Agent Console established both the
 * shape and the reason: a preview that computes precedence its own way is worse
 * than no preview, because people believe it.
 */
function PrecedencePreview({
  masterEnabled,
  orgConfig,
  overrides,
}: {
  masterEnabled: boolean;
  orgConfig: AutoReplyConfig | null;
  overrides: { config: AutoReplyConfig; jobTitle: string | null }[];
}) {
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const open = overrides.find((override) => override.config.job_id === openJobId) ?? null;

  return (
    <div className="card">
      <h2 className="title is-5 mb-1">What actually applies</h2>
      <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
        Computed by the same code the agent runs, so this is what would happen — not a
        description of what should.
      </p>

      <div className="is-flex mb-3" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        {overrides.map(({ config, jobTitle }) => (
          <button
            key={config.id}
            type="button"
            className={`button is-small ${openJobId === config.job_id ? "is-primary" : ""}`}
            onClick={() =>
              setOpenJobId(openJobId === config.job_id ? null : (config.job_id as string))
            }
          >
            {jobTitle ?? "Archived job"}
          </button>
        ))}
      </div>

      {open === null ? (
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Choose a job above to compare it against the organization default.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table is-fullwidth" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Org default</th>
                <th>{open.jobTitle ?? "This job"}</th>
                <th>Effective</th>
              </tr>
            </thead>
            <tbody>
              {autoReplyPrecedenceRows({
                masterEnabled,
                orgConfig,
                jobConfig: open.config,
              }).map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="has-text-secondary">{row.orgDefault ?? "—"}</td>
                  <td className="has-text-secondary">{row.jobOverride ?? "—"}</td>
                  <td>
                    <strong>{row.effective ?? "Nothing sent"}</strong>
                    {row.source !== "unset" && (
                      <span className="has-text-secondary" style={{ fontSize: 11 }}>
                        {" "}
                        (from {row.source === "job" ? "this job" : "the default"})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The one form, used for the organization default and for a job override. */
function ConfigForm({
  scope,
  existing,
  onDone,
  onCancel,
}: {
  scope: Exclude<Editing, null>;
  existing: AutoReplyConfig | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [timing, setTiming] = useState<AutoReplyTiming>(
    existing?.response_timing ?? "immediate"
  );
  const [delayMinutes, setDelayMinutes] = useState(String(existing?.delay_minutes ?? 15));
  const [tone, setTone] = useState(existing?.tone_instructions ?? "");
  const [context, setContext] = useState(existing?.context_instructions ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/auto-reply", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: scope.scope === "job" ? scope.jobId : null,
          enabled,
          response_timing: timing,
          delay_minutes: timing === "delayed" ? Number(delayMinutes) : null,
          tone_instructions: tone,
          context_instructions: context,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Couldn't save that.");
        return;
      }

      onDone();
    } catch {
      setError("Couldn't reach the server. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="title is-5 mb-3">
        {scope.scope === "organization"
          ? "Organization default"
          : `Override for ${scope.jobTitle ?? "this job"}`}
      </h2>

      <FormError message={error} />

      <div className="mb-4">
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label={enabled ? "Auto-reply on" : "Auto-reply off"}
        />
        {scope.scope === "job" && !enabled && (
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Off here stops the agent for this job even if the organization default is on. Remove
            the override entirely to go back to the default.
          </p>
        )}
      </div>

      <div className="field mb-4">
        <label className="label" style={{ fontSize: 14 }} htmlFor="auto-reply-timing">
          Response timing
        </label>
        <div className="select">
          <select
            id="auto-reply-timing"
            value={timing}
            onChange={(event) => setTiming(event.target.value as AutoReplyTiming)}
          >
            <option value="immediate">Immediate</option>
            <option value="delayed">Delayed</option>
          </select>
        </div>

        {timing === "delayed" ? (
          <>
            <div className="is-flex mt-2 is-align-items-center" style={{ gap: "0.5rem" }}>
              <input
                className="input"
                type="number"
                min={AUTO_REPLY_LIMITS.minDelayMinutes}
                max={AUTO_REPLY_LIMITS.maxDelayMinutes}
                value={delayMinutes}
                onChange={(event) => setDelayMinutes(event.target.value)}
                style={{ maxWidth: 120 }}
                aria-label="Delay in minutes"
              />
              <span className="has-text-secondary" style={{ fontSize: 13 }}>
                minutes
              </span>
            </div>
            <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
              A delayed reply is sent by the scheduled sweep, which runs every five minutes — so
              treat the delay as a floor, not an exact time. The delay is also a second chance for
              a colleague to get there first: if anybody replies by hand in the meantime, the agent
              stands down.
            </p>
          </>
        ) : (
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Sent as the message arrives, usually within a few seconds.
          </p>
        )}
      </div>

      <div className="field mb-4">
        <label className="label" style={{ fontSize: 14 }} htmlFor="auto-reply-tone">
          Tone guidance
        </label>
        <textarea
          id="auto-reply-tone"
          className="textarea"
          rows={3}
          maxLength={AUTO_REPLY_LIMITS.toneMax}
          value={tone}
          onChange={(event) => setTone(event.target.value)}
          placeholder="Friendly but professional. Keep replies to a couple of sentences."
        />
        <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
          Free text, not a template — there are no {"{{fields}}"} to insert here. Write it as you
          would brief a new coordinator.
        </p>
      </div>

      <div className="field mb-4">
        <label className="label" style={{ fontSize: 14 }} htmlFor="auto-reply-context">
          Context rules
        </label>
        <textarea
          id="auto-reply-context"
          className="textarea"
          rows={4}
          maxLength={AUTO_REPLY_LIMITS.contextMax}
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder="Never discuss notice periods. Always point people at their calendar invite for joining details."
        />
        <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
          What to prioritise or avoid. These are preferences layered on top of the agent&apos;s own
          rules — they cannot loosen them. Pay, contested decisions, visas and anything sensitive
          are always handed to a person, whatever is written here.
        </p>
      </div>

      <div className="is-flex" style={{ gap: "0.5rem" }}>
        <Button variant="primary" loading={saving} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
