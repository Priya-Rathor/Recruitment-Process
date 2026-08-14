"use client";

// The review screen. AI extracts, human verifies — the same pattern as resume
// parsing, applied to a call.
//
// Two things are always visible and never collapsed away:
//   - fields the model itself was unsure about, marked so they get checked first
//   - what the model originally said, whenever a value has since been corrected
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { ScreeningReport } from "@/lib/screening/reportQueries";
import { FIELD_LABELS, type CorrectableField } from "@/lib/screening/report";
import type { InterestLevel, LocationAcceptance } from "@/lib/ai/generateScreeningSummary";

const INTEREST_OPTIONS: { value: InterestLevel; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "unclear", label: "Unclear" },
];

const LOCATION_OPTIONS: { value: LocationAcceptance; label: string }[] = [
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Declined" },
  { value: "unclear", label: "Unclear" },
];

/** Marks a field the model flagged as uncertain. */
function UncertainTag() {
  return (
    <span
      className="tag ml-2"
      style={{
        background: "var(--status-attention-bg)",
        color: "var(--status-attention-text)",
        fontSize: 10,
        fontWeight: 600,
      }}
      title="The AI wasn't confident about this — check it against the transcript"
    >
      check this
    </span>
  );
}

/** Shows what the model originally said, once a human has changed it. */
function OriginalValue({ value }: { value: string }) {
  return (
    <p className="has-text-secondary mt-1" style={{ fontSize: 11 }}>
      AI originally said: {value}
    </p>
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function ReportEditor({
  report,
  canReview,
}: {
  report: ScreeningReport;
  canReview: boolean;
}) {
  const router = useRouter();

  const [summary, setSummary] = useState(report.summary_text);
  const [interest, setInterest] = useState<InterestLevel>(report.interest_level);
  const [ctc, setCtc] = useState<string>(report.expected_ctc?.toString() ?? "");
  const [notice, setNotice] = useState<string>(report.notice_period_days?.toString() ?? "");
  const [location, setLocation] = useState<LocationAcceptance>(report.location_accepted);
  const [availability, setAvailability] = useState(report.availability_notes ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uncertain = new Set(report.uncertain_fields);
  const corrected = new Set(report.corrected_fields);

  const isUncertain = (field: CorrectableField) => uncertain.has(field) && !corrected.has(field);

  async function save() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/screening-reports/${report.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        corrections: {
          summary_text: summary,
          interest_level: interest,
          expected_ctc: ctc === "" ? null : Number(ctc),
          notice_period_days: notice === "" ? null : Number(notice),
          location_accepted: location,
          availability_notes: availability,
        },
      }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save that review.");
      return;
    }

    router.refresh();
  }

  if (!canReview) {
    return (
      <div className="card">
        <h2 className="title is-5">Screening report</h2>
        <p style={{ fontSize: 15 }}>{report.summary_text}</p>
        <p className="has-text-secondary mt-3" style={{ fontSize: 13 }}>
          Your role can read this report but not correct it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <FormError message={error} />

      <div className="card mb-4">
        <h2 className="title is-5">
          Summary
          {isUncertain("summary_text") && <UncertainTag />}
        </h2>
        <textarea
          className="textarea"
          rows={4}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
        {corrected.has("summary_text") && <OriginalValue value={report.ai_summary_text} />}
      </div>

      <div className="card mb-4">
        <h2 className="title is-5">What the candidate said</h2>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="interest">
              {FIELD_LABELS.interest_level}
              {isUncertain("interest_level") && <UncertainTag />}
            </label>
            <div className="select is-fullwidth">
              <select
                id="interest"
                value={interest}
                onChange={(event) => setInterest(event.target.value as InterestLevel)}
              >
                {INTEREST_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {corrected.has("interest_level") && (
              <OriginalValue value={report.ai_interest_level} />
            )}
          </div>

          <div className="column">
            <label className="label" htmlFor="location">
              {FIELD_LABELS.location_accepted}
              {isUncertain("location_accepted") && <UncertainTag />}
            </label>
            <div className="select is-fullwidth">
              <select
                id="location"
                value={location}
                onChange={(event) => setLocation(event.target.value as LocationAcceptance)}
              >
                {LOCATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {corrected.has("location_accepted") && (
              <OriginalValue value={report.ai_location_accepted} />
            )}
          </div>
        </div>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="ctc">
              {FIELD_LABELS.expected_ctc}
              {isUncertain("expected_ctc") && <UncertainTag />}
            </label>
            <input
              id="ctc"
              className="input"
              type="number"
              min={0}
              value={ctc}
              onChange={(event) => setCtc(event.target.value)}
            />
            {corrected.has("expected_ctc") && (
              <OriginalValue value={displayValue(report.ai_expected_ctc)} />
            )}
          </div>

          <div className="column">
            <label className="label" htmlFor="notice">
              {FIELD_LABELS.notice_period_days} (days)
              {isUncertain("notice_period_days") && <UncertainTag />}
            </label>
            <input
              id="notice"
              className="input"
              type="number"
              min={0}
              max={365}
              value={notice}
              onChange={(event) => setNotice(event.target.value)}
            />
            {corrected.has("notice_period_days") && (
              <OriginalValue value={displayValue(report.ai_notice_period_days)} />
            )}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="availability">
            {FIELD_LABELS.availability_notes}
            {isUncertain("availability_notes") && <UncertainTag />}
          </label>
          <input
            id="availability"
            className="input"
            type="text"
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
          />
          {corrected.has("availability_notes") && (
            <OriginalValue value={displayValue(report.ai_availability_notes)} />
          )}
        </div>
      </div>

      <div className="card">
        <div className="is-flex is-justify-content-space-between is-align-items-center">
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {report.reviewed_at
              ? `Reviewed by ${report.reviewer_name ?? "a teammate"}. Saving again updates it.`
              : "Marking this reviewed makes it authoritative for the pipeline and analytics."}
          </p>
          <button
            type="button"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            onClick={save}
            disabled={busy}
          >
            {report.reviewed_at ? "Save changes" : "Save and mark reviewed"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Generate / regenerate control, shown when there is no report yet. */
export function GenerateReportButton({
  applicationId,
  label,
}: {
  applicationId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}/screening-report`, {
      method: "POST",
    });
    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not generate the report.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <FormError message={error} />
      <button
        type="button"
        className={`button is-primary ${busy ? "is-loading" : ""}`}
        onClick={generate}
        disabled={busy}
      >
        {label}
      </button>
    </div>
  );
}
