"use client";

// The interviewer's brief.
//
// Generation is explicit rather than automatic: it costs an AI call, and the
// interviewer wants it just before the interview, not every time the page loads.
//
// The panel states plainly that this prepares rather than evaluates — an
// interviewer handed a document that looks like a verdict will interview to
// confirm it rather than to find out.
import { useState } from "react";
import { FormError } from "@/components/states";
import type { InterviewBrief } from "@/lib/ai/generateInterviewBrief";

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <p style={{ fontSize: 13, fontWeight: 600 }}>{title}</p>
      <ul style={{ fontSize: 14, listStyle: "disc", paddingLeft: "1.25rem" }}>
        {items.map((item) => (
          <li key={item} className="py-1">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BriefPanel({ applicationId }: { applicationId: string }) {
  const [brief, setBrief] = useState<InterviewBrief | null>(null);
  const [usedReviewedReport, setUsedReviewedReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/interview-brief`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Couldn't prepare a brief.");
        return;
      }

      setBrief(payload.data as InterviewBrief);
      setUsedReviewedReport(Boolean(payload.usedReviewedReport));
    } catch {
      setError("Couldn't reach the AI service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <FormError message={error} />

      {!brief && (
        <div className="card">
          <h2 className="title is-5">Prepare for this interview</h2>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Pulls together what the match and the screening report already say, so you know what to
            confirm and what to actually establish.
          </p>
          <button
            type="button"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            onClick={generate}
            disabled={busy}
          >
            Prepare brief
          </button>
        </div>
      )}

      {brief && (
        <>
          <div className="ai-panel mb-4">
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
              Preparation, not an assessment
            </p>
            <p className="mt-2" style={{ fontSize: 14 }}>
              This orients you before the interview. It deliberately contains no verdict, score, or
              hiring recommendation — that is yours to form afterwards.
            </p>
            {!usedReviewedReport && (
              <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
                No reviewed screening report was available, so salary and notice details are not
                included.
              </p>
            )}
          </div>

          <div className="card mb-4">
            <h2 className="title is-5">Summary</h2>
            <p style={{ fontSize: 15 }}>{brief.summary}</p>
          </div>

          <div className="card mb-4">
            <Section title="Looks solid — confirm rather than re-cover" items={brief.strongAreas} />
            <Section title="What this interview should establish" items={brief.areasToVerify} />
          </div>

          {brief.suggestedQuestions.length > 0 && (
            <div className="card mb-4">
              <h2 className="title is-5">Suggested questions</h2>
              <ol style={{ fontSize: 14, listStyle: "decimal", paddingLeft: "1.25rem" }}>
                {brief.suggestedQuestions.map((question) => (
                  <li key={question} className="py-1">
                    {question}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <button
            type="button"
            className={`button is-small ${busy ? "is-loading" : ""}`}
            onClick={generate}
            disabled={busy}
          >
            Prepare again
          </button>
        </>
      )}
    </div>
  );
}
