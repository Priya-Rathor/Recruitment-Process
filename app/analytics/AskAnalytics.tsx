"use client";

import { useState } from "react";
import { FormError } from "@/components/states";

/**
 * Ask Analytics AI.
 *
 * On demand, never on page load — it costs a call, and the tiles above already
 * answer most questions.
 *
 * When the numeric guard rejects an explanation the API returns 422 and the
 * reason is shown rather than swallowed. That is deliberate: a manager who
 * learns the narration can be wrong reads the tiles, which is the correct habit.
 * The tiles never move, so a rejected explanation costs nothing but the click.
 */
export function AskAnalytics({ query }: { query: string }) {
  const [question, setQuestion] = useState("");
  const [narrative, setNarrative] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(asked?: string) {
    const text = (asked ?? question).trim();

    setBusy(true);
    setError(null);
    setNarrative(null);

    try {
      const response = await fetch(`/api/analytics/ai-action${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text || null }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't explain these numbers.");
        return;
      }

      setNarrative(payload.data.narrative);
      setSuggestions(payload.data.suggestedQuestions ?? []);
      if (asked) setQuestion(asked);
    } catch {
      setError("Couldn't reach the AI service. The metrics above are unaffected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-4">
      <h2 className="title is-5 mb-1">Ask Analytics AI</h2>
      <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
        Explains the figures on this page. It can only describe what&apos;s shown — a summary that
        quotes a number not in the report is discarded rather than displayed.
      </p>

      <div className="is-flex mb-3" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "1 1 320px" }}
          placeholder="Why did placements drop this month?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) ask();
          }}
        />
        <button
          type="button"
          className={`button is-primary ${busy ? "is-loading" : ""}`}
          onClick={() => ask()}
          disabled={busy}
        >
          {question.trim().length > 0 ? "Ask" : "Explain this period"}
        </button>
      </div>

      <FormError message={error} />

      {narrative && (
        <>
          <p style={{ fontSize: 15 }}>{narrative}</p>
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Written from the metrics on this page. Every figure it states is one of theirs.
          </p>
        </>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="has-text-secondary mb-2" style={{ fontSize: 12 }}>
            You could also ask:
          </p>
          <div className="buttons">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="button is-small"
                onClick={() => ask(suggestion)}
                disabled={busy}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
