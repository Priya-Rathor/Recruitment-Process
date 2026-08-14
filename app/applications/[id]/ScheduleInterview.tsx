"use client";

// Schedule an interview from the application.
//
// The calendar message is surfaced as INFORMATION on success, never as an
// error: the spec requires calendar failure not to block scheduling, so an
// interview that saved without an invite is a success with a caveat.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import { INTERVIEW_MODES, MODE_LABELS, type InterviewMode } from "@/lib/interviews/feedback";

export function ScheduleInterview({
  applicationId,
  members,
  canSchedule,
}: {
  applicationId: string;
  members: { id: string; name: string }[];
  canSchedule: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [mode, setMode] = useState<InterviewMode>("video");
  const [interviewerId, setInterviewerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!canSchedule) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const response = await fetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: applicationId,
        scheduled_at: new Date(scheduledAt).toISOString(),
        duration_minutes: duration,
        mode,
        interviewer_id: interviewerId || null,
      }),
    });

    const payload = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not schedule that interview.");
      return;
    }

    // Scheduled successfully; the calendar may still have been unavailable.
    if (payload?.calendarMessage) {
      setNotice(payload.calendarMessage);
    }

    setOpen(false);
    router.push(`/interviews/${payload.data.id}`);
    router.refresh();
  }

  if (!open) {
    return (
      <div>
        {notice && (
          <p className="has-text-secondary mb-2" style={{ fontSize: 12 }}>
            {notice}
          </p>
        )}
        <button
          type="button"
          className="button is-small is-fullwidth"
          onClick={() => setOpen(true)}
        >
          Schedule interview
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <FormError message={error} />

      <div className="field">
        <label className="label" style={{ fontSize: 13 }} htmlFor="when">
          When
        </label>
        <input
          id="when"
          className="input is-small"
          type="datetime-local"
          required
          value={scheduledAt}
          onChange={(event) => setScheduledAt(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" style={{ fontSize: 13 }} htmlFor="duration">
          Minutes
        </label>
        <input
          id="duration"
          className="input is-small"
          type="number"
          min={15}
          max={480}
          step={15}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
        />
      </div>

      <div className="field">
        <label className="label" style={{ fontSize: 13 }} htmlFor="mode">
          Mode
        </label>
        <div className="select is-small is-fullwidth">
          <select
            id="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as InterviewMode)}
          >
            {INTERVIEW_MODES.map((option) => (
              <option key={option} value={option}>
                {MODE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="label" style={{ fontSize: 13 }} htmlFor="interviewer">
          Interviewer
        </label>
        <div className="select is-small is-fullwidth">
          <select
            id="interviewer"
            value={interviewerId}
            onChange={(event) => setInterviewerId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="buttons">
        <button
          type="submit"
          className={`button is-small is-primary ${busy ? "is-loading" : ""}`}
          disabled={busy || !scheduledAt}
        >
          Schedule
        </button>
        <button
          type="button"
          className="button is-small"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
