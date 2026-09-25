"use client";

// =============================================================================
// Section 7 — Default Call Data, and the precedence preview.
//
// The section exists to answer one question an admin cannot otherwise answer:
// "if I set this here, does the job still win?" The helper text says yes; the
// preview table PROVES it against a real job, and both the table and the real
// call get their answer from lib/voice/callData.ts, so they cannot disagree.
//
// The placeholder picker is components/PlaceholderEditor — the same component the
// Job Hiring Stages prompt editors use, with the same catalogue. Not a compact
// re-implementation: a second insertToken() that forgets the caret makes
// inserting a second field maddening, and a second preview that renders
// differently from the real call is worse than none because it is believed.
//
// The catalogue passed is the DEFAULT one (job + candidate/application fields).
// That is deliberate — it is exactly the vocabulary a screening call can resolve.
// Offering {{interview.time}} here would produce a sentence with a hole in it,
// read aloud to a candidate.
// =============================================================================

import { useEffect, useState } from "react";
import { ArrowUp, Info, Plus, Trash2, Type } from "lucide-react";
import { PlaceholderEditor } from "@/components/PlaceholderEditor";
import { StringListEditor } from "@/app/jobs/StringListEditor";
import { StatusChip } from "@/components/ui/StatusChip";
import { SkeletonRows } from "@/components/ui/states";
import {
  CALL_DATA_LIMITS,
  SUGGESTED_CALL_DATA_KEYS,
  normalizeCallDataKey,
  type DefaultCallData,
  type PrecedenceRow,
} from "@/lib/voice/callData";
import type { PreviewJobOption } from "@/lib/voice/queries";

/** Keys the call payload owns. Typing one of these is a mistake worth naming. */
const RESERVED_KEYS = new Set(["script", "questions", "language", "is_test"]);

export function CallDataSection({
  callData,
  onChange,
  jobs,
  agentSystemPrompt,
  agentCompanyName,
}: {
  callData: DefaultCallData;
  onChange: (next: DefaultCallData) => void;
  jobs: PreviewJobOption[];
  /** Sent with the preview request so it reflects UNSAVED edits. */
  agentSystemPrompt: string;
  agentCompanyName: string | null;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");

  const setFields = (fields: DefaultCallData["fields"]) => onChange({ ...callData, fields });

  function addField(key: string) {
    const normalized = normalizeCallDataKey(key);
    if (!normalized) return;
    if (callData.fields.some((field) => field.key === normalized)) {
      setExpandedKey(normalized);
      return;
    }
    setFields([...callData.fields, { key: normalized, value: "" }]);
    setExpandedKey(normalized);
    setDraftKey("");
  }

  const used = new Set(callData.fields.map((field) => field.key));
  const suggestions = SUGGESTED_CALL_DATA_KEYS.filter((entry) => !used.has(entry.key));
  const atLimit = callData.fields.length >= CALL_DATA_LIMITS.fieldCount;

  return (
    <>
      {/*
        The rule, stated before the controls rather than after them. Someone
        setting a default needs to know it is a fallback BEFORE they type it —
        finding out afterwards, from a table, is how "why did my default not
        apply?" tickets get written.
      */}
      <div className="vac-callout">
        <Info size={15} aria-hidden="true" />
        <p>
          These are used when a job doesn&apos;t specify its own AI Screening Call configuration. A
          job&apos;s own settings (under <strong>Hiring Stages</strong>) always take priority over
          these defaults.
        </p>
      </div>

      {/* --- The key/value list ------------------------------------------- */}
      <div className="vac-calldata">
        <p className="label">Default fields</p>
        <p className="stage-field__help">
          Passed into every screening call as context. Values may use {"{{field}}"} placeholders.
        </p>

        {callData.fields.length === 0 && (
          <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
            None yet.
          </p>
        )}

        {callData.fields.map((field, index) => (
          <div key={field.key} className="vac-calldata__entry">
            <div className="repeatable__row">
              <div className="repeatable__fields">
                <input
                  className="input"
                  type="text"
                  aria-label={`Field name ${index + 1}`}
                  value={field.key}
                  onChange={(event) => {
                    const next = [...callData.fields];
                    // NOT normalised on every keystroke: turning "company name"
                    // into "company_name" mid-word fights the person typing. It is
                    // normalised on blur, and again on save.
                    next[index] = { ...next[index], key: event.target.value };
                    setFields(next);
                  }}
                  onBlur={(event) => {
                    const normalized = normalizeCallDataKey(event.target.value);
                    const next = [...callData.fields];
                    next[index] = { ...next[index], key: normalized ?? "" };
                    setFields(next.filter((entry) => entry.key.length > 0));
                  }}
                />
                <input
                  className="input"
                  type="text"
                  aria-label={`Value for ${field.key}`}
                  placeholder="Value"
                  value={field.value}
                  onChange={(event) => {
                    const next = [...callData.fields];
                    next[index] = { ...next[index], value: event.target.value };
                    setFields(next);
                  }}
                />
              </div>

              <button
                type="button"
                className="button is-small"
                aria-expanded={expandedKey === field.key}
                onClick={() =>
                  setExpandedKey((current) => (current === field.key ? null : field.key))
                }
              >
                <Type size={13} aria-hidden="true" />
                Fields
              </button>

              <button
                type="button"
                className="button is-small"
                aria-label={`Move ${field.key} up`}
                disabled={index === 0}
                onClick={() => {
                  const next = [...callData.fields];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  setFields(next);
                }}
              >
                <ArrowUp size={13} aria-hidden="true" />
              </button>

              <button
                type="button"
                className="button is-small repeatable__remove"
                aria-label={`Remove ${field.key}`}
                onClick={() => {
                  setFields(callData.fields.filter((_, i) => i !== index));
                  if (expandedKey === field.key) setExpandedKey(null);
                }}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>

            {RESERVED_KEYS.has(field.key) && (
              <p className="stage-warning">
                <code>{field.key}</code> is part of the call itself and can&apos;t be overridden
                here — this field will be ignored. Rename it.
              </p>
            )}

            {/*
              The shared placeholder editor, opened for one field at a time. Bound
              to this row's value, so inserting a token writes into the same
              string the compact input above shows.
            */}
            {expandedKey === field.key && (
              <div className="vac-calldata__editor">
                <PlaceholderEditor
                  id={`calldata-${field.key}`}
                  label={`Value for ${field.key}`}
                  help="Insert a job or candidate field to have it filled in per call."
                  value={field.value}
                  rows={3}
                  onChange={(value) => {
                    const next = [...callData.fields];
                    next[index] = { ...next[index], value };
                    setFields(next);
                  }}
                />
              </div>
            )}
          </div>
        ))}

        {!atLimit && (
          <div className="vac-calldata__add">
            <input
              className="input"
              type="text"
              placeholder="New field name, e.g. recruiter_signoff_name"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addField(draftKey);
                }
              }}
            />
            <button
              type="button"
              className="button is-primary is-small"
              disabled={!draftKey.trim()}
              onClick={() => addField(draftKey)}
            >
              <Plus size={13} aria-hidden="true" />
              Add
            </button>
          </div>
        )}

        {atLimit && (
          <p className="stage-warning">
            That&apos;s the maximum of {CALL_DATA_LIMITS.fieldCount} default fields.
          </p>
        )}

        {suggestions.length > 0 && !atLimit && (
          <div className="vac-suggestions">
            <span className="vac-suggestions__label">Common fields:</span>
            {suggestions.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="vac-suggestions__chip"
                title={entry.hint}
                onClick={() => addField(entry.key)}
              >
                <Plus size={11} aria-hidden="true" />
                {entry.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* --- Fallback questions ------------------------------------------- */}
      <div className="vac-calldata__questions">
        <StringListEditor
          label="Fallback screening questions"
          help="Asked ONLY when a job has AI Screening Call enabled but hasn't set up its own questions. A job with its own list always uses that list instead — never both."
          items={callData.fallbackQuestions}
          onChange={(fallbackQuestions) => onChange({ ...callData, fallbackQuestions })}
          placeholder="e.g. What's your notice period?"
        />
      </div>

      {/* --- The proof ---------------------------------------------------- */}
      <PrecedencePreview
        jobs={jobs}
        callData={callData}
        agentSystemPrompt={agentSystemPrompt}
        agentCompanyName={agentCompanyName}
      />
    </>
  );
}

/**
 * The read-only precedence table.
 *
 * Re-requested whenever the job or the unsaved call data changes, debounced, so
 * an admin sees the consequence of the value they just typed rather than of the
 * one they replaced. Computed on the server because the job side of the
 * comparison is a database fact, not something the browser should be able to
 * assert.
 */
function PrecedencePreview({
  jobs,
  callData,
  agentSystemPrompt,
  agentCompanyName,
}: {
  jobs: PreviewJobOption[];
  callData: DefaultCallData;
  agentSystemPrompt: string;
  agentCompanyName: string | null;
}) {
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [rows, setRows] = useState<PrecedenceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No id means there are no jobs at all, and the component has already
    // returned the "nothing to compare against" state above — so there is
    // nothing to clear here.
    if (!jobId) return;

    // `cancelled` is declared OUTSIDE the timeout so the effect's cleanup can
    // actually set it. Declared inside, a returned cleanup would be handed to
    // setTimeout, which ignores it — and a stale response would then overwrite a
    // newer one, making the table lag a keystroke behind the form.
    let cancelled = false;

    // Debounced: this fires on every keystroke in the section above, and the
    // preview is a nicety — it must never be the reason the page feels slow.
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);

      fetch("/api/settings/voice-agents/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, callData, agentSystemPrompt, agentCompanyName }),
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (cancelled) return;
          if (!response.ok) {
            setRows(null);
            setError(payload?.error ?? "Couldn't work out the effective values.");
            return;
          }
          setRows(payload.data.rows as PrecedenceRow[]);
        })
        .catch(() => {
          if (!cancelled) setError("Couldn't reach the server for the preview.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, callData, agentSystemPrompt, agentCompanyName]);

  if (jobs.length === 0) {
    return (
      <div className="vac-preview">
        <p className="label">What a job would actually use</p>
        <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
          There are no jobs yet, so there is nothing to compare these defaults against. Create a job
          and this table will show which values it would use.
        </p>
      </div>
    );
  }

  const selected = jobs.find((job) => job.id === jobId);

  return (
    <div className="vac-preview">
      <div className="vac-preview__head">
        <div>
          <p className="label">What a job would actually use</p>
          <p className="stage-field__help">
            Read-only. Shows where each value comes from, so the precedence rule is visible rather
            than just described.
          </p>
        </div>

        <div className="select is-small">
          <select
            aria-label="Job to preview"
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
                {job.screeningEnabled ? "" : " (screening off)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected && !selected.screeningEnabled && (
        <p className="stage-note">
          This job has AI Screening Call switched off, so nothing here runs for it yet. The table
          still shows what it would use.
        </p>
      )}

      {error && <p className="stage-warning">{error}</p>}

      {loading && !rows && <SkeletonRows rows={4} />}

      {rows && (
        <div className="vac-table-scroll">
          <table className="table is-fullwidth vac-preview__table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Org default</th>
                <th>This job&apos;s override</th>
                <th>Effective value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="vac-preview__field">{row.label}</span>
                    <span className="vac-preview__note">{row.note}</span>
                  </td>
                  <td className={row.source === "organization" ? "" : "vac-preview__muted"}>
                    {row.orgDefault ?? <span className="vac-preview__unset">not set</span>}
                  </td>
                  <td className={row.source === "job" ? "" : "vac-preview__muted"}>
                    {row.jobOverride ?? <span className="vac-preview__unset">none</span>}
                  </td>
                  <td>
                    <div className="vac-preview__effective">
                      <span>
                        {row.effective ?? <span className="vac-preview__unset">nothing</span>}
                      </span>
                      {/*
                        The source chip is the whole point of the column. Colour
                        alone would not say it — StatusChip always carries an icon
                        and a word, which is what makes this legible in greyscale
                        and to a colour-blind reader.
                      */}
                      {row.source === "job" && <StatusChip tone="info" label="Job" />}
                      {row.source === "organization" && (
                        <StatusChip tone="neutral" label="Org default" />
                      )}
                      {row.source === "unset" && <StatusChip tone="warning" label="Unset" />}
                    </div>
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
