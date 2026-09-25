"use client";

// =============================================================================
// "AI Edit" on the agent's instructions.
//
// PROPOSE, THEN CONFIRM. NEVER OVERWRITE.
//
// The revision arrives as a proposal shown beside the current text, with Accept
// and Discard. Nothing touches the field until Accept is pressed, and Discard
// leaves the original byte for byte — which is the pattern this product uses
// wherever an AI edits text a person owns (Resume AI's conflict review, Module
// 15's tone adjustment). The reason is always the same: a fluent rewrite is
// exactly what a reviewer skims past, so the review has to be a step, not a
// glance.
//
// Accept only writes into the FORM. Persisting still requires the page's own
// Save — so an accepted revision is as reversible as any other edit right up to
// the moment somebody saves it.
// =============================================================================

import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/states";
import { MAX_INSTRUCTION_LENGTH } from "@/lib/ai/refineAgentPrompt";

type Proposal = { proposed: string; summary: string; preservedGuardrails: string[] };

export function PromptAiEdit({
  agentId,
  currentPrompt,
  onAccept,
}: {
  agentId: string;
  /** The live field value, including unsaved edits. */
  currentPrompt: string;
  onAccept: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  async function request() {
    const change = instruction.trim();
    if (change.length === 0) return;

    setBusy(true);
    setError(null);
    setProposal(null);

    try {
      const response = await fetch(`/api/settings/voice-agents/${agentId}/prompt-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: change, currentPrompt }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // The refusals are meaningful here — "that edit would have dropped a
        // guardrail" is the message, and it names the guardrail. Shown verbatim.
        setError(payload?.error ?? "Couldn't draft a revision.");
        return;
      }

      setProposal(payload.data as Proposal);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setInstruction("");
    setProposal(null);
    setError(null);
  }

  return (
    <div className="vac-aiedit">
      <button
        type="button"
        className="vac-aiedit__trigger"
        aria-expanded={open}
        onClick={() => (open ? reset() : setOpen(true))}
      >
        <Sparkles size={13} aria-hidden="true" />
        AI Edit
      </button>

      {open && (
        <div className="vac-aiedit__panel">
          {!proposal ? (
            <>
              <label className="label" htmlFor="vac-aiedit-input">
                Describe what you want to change
              </label>
              <p className="stage-field__help">
                e.g. &ldquo;make her sound more formal&rdquo;, or &ldquo;add a line about remote
                work flexibility&rdquo;.
              </p>
              <input
                id="vac-aiedit-input"
                className="input"
                type="text"
                maxLength={MAX_INSTRUCTION_LENGTH}
                placeholder="make her sound more formal"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void request();
                  }
                }}
              />

              <FormError message={error} />

              <div className="buttons mt-3">
                <Button
                  size="small"
                  variant="primary"
                  loading={busy}
                  disabled={instruction.trim().length === 0}
                  onClick={request}
                >
                  Draft a revision
                </Button>
                <Button size="small" onClick={reset} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="vac-aiedit__summary">
                <Sparkles size={13} aria-hidden="true" />
                {proposal.summary}
              </p>

              {/*
                The FULL proposed text, not a diff summary. A prompt is read as a
                whole by the model that runs it, so it has to be reviewed as a
                whole — a highlighted three-word change hides what happened to the
                paragraph around it.
              */}
              <p className="stage-preview__label">Proposed instructions</p>
              <pre className="vac-aiedit__proposed">{proposal.proposed}</pre>

              {proposal.preservedGuardrails.length > 0 && (
                /* What was CHECKED, not just what was produced. The server rejects
                   a revision that drops a guardrail; saying which ones survived is
                   how a reviewer knows that check ran. */
                <p className="vac-aiedit__checked">
                  Guardrails still present: {proposal.preservedGuardrails.length} of{" "}
                  {proposal.preservedGuardrails.length}
                </p>
              )}

              <div className="buttons mt-3">
                <Button
                  size="small"
                  variant="primary"
                  icon={Check}
                  onClick={() => {
                    onAccept(proposal.proposed);
                    reset();
                  }}
                >
                  Accept
                </Button>
                <Button size="small" icon={X} onClick={reset}>
                  Discard
                </Button>
              </div>

              <p className="vac-aiedit__note">
                Accepting replaces the text in the field. Nothing is stored until you press{" "}
                <strong>Save agent</strong>.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
