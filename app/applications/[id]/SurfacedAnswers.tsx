// =============================================================================
// Form answers surfaced onto the application.
//
// A SERVER COMPONENT — no "use client". It renders values and has no state, no
// handlers and nothing to hydrate, so shipping it to the browser would cost a
// bundle for markup that never changes after paint.
//
// -----------------------------------------------------------------------------
// EVERY VALUE HERE IS READ BY REFERENCE.
//
// Nothing on this card is stored on the application. loadSurfacedAnswers() reads
// form_responses.raw_answers at render time, so a candidate who resubmits shows
// their new answer on the next load, and a response deleted by Module 22's
// retention rules takes the surfaced field with it.
//
// -----------------------------------------------------------------------------
// "NOT ANSWERED YET" AND "ANSWERED, LEFT BLANK" ARE RENDERED DIFFERENTLY.
//
// They look identical in a naive implementation and mean opposite things. A
// recruiter who sees an em dash where the candidate actually skipped the
// question will chase them for a form they already returned.
// =============================================================================
import { CalendarClock } from "lucide-react";
import { formatDateTimeInZone } from "@/lib/time";
import type { SurfacedAnswer } from "@/lib/workflow/formAnswers";

export function SurfacedAnswers({
  answers,
  timeZone,
}: {
  answers: SurfacedAnswer[];
  /** The ORGANIZATION's timezone — never the server's or the browser's. */
  timeZone: string;
}) {
  // No card at all rather than an empty one. A job whose workflow surfaces
  // nothing has no question to answer here, and a card saying so would be a
  // permanent empty box on every application in the system.
  if (answers.length === 0) return null;

  return (
    <section className="card mb-4">
      <div className="is-flex is-align-items-center mb-1" style={{ gap: "0.4rem" }}>
        <CalendarClock size={15} aria-hidden />
        <h2 className="title is-6 mb-0">What the candidate told us</h2>
      </div>
      <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
        Read from their form responses. Read-only here — edit the questions on the form itself.
      </p>

      {answers.map((answer) => (
        <div
          key={`${answer.formName}:${answer.label}`}
          className="is-flex is-justify-content-space-between"
          style={{
            gap: "1rem",
            padding: "8px 0",
            borderTop: "1px solid var(--color-border)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600 }}>{answer.label}</p>
            <p className="has-text-secondary" style={{ fontSize: 11 }}>
              from &ldquo;{answer.formName}&rdquo;
              {answer.answeredAt && ` · ${formatDateTimeInZone(answer.answeredAt, timeZone)}`}
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            {answer.value === null ? (
              <span className="has-text-secondary" style={{ fontSize: 13 }}>
                Not answered yet
              </span>
            ) : answer.value.trim() === "" ? (
              /* Answered, and left blank. See the header — not the same thing. */
              <span className="has-text-secondary" style={{ fontSize: 13, fontStyle: "italic" }}>
                Left blank
              </span>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 600 }}>{answer.value}</span>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
