"use client";

// =============================================================================
// The suggested next step.
//
// A SUGGESTION with a button, never an action. Clicking routes into the same
// move-to-stage control the page already has, which carries its own
// confirmation — this banner has no write path of its own at all.
//
// Dismissal is local and per-session. It hides a recommendation; it does not
// record a decision, and it never touches the application's stage. Persisting a
// dismissal would need a column, and "I don't want to see this right now" is
// not a fact about the candidate.
// =============================================================================

import { useState } from "react";
import { X } from "lucide-react";
import { NEXT_ACTION_TONE, type NextAction } from "@/lib/evaluation/nextAction";

export function NextActionBanner({
  action,
  canAct,
  onAct,
}: {
  action: NextAction;
  /** Viewer sees the suggestion and cannot act on it. */
  canAct: boolean;
  /** Scrolls to the move control and preselects the target stage. */
  onAct: (targetStage: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || action.kind === "none") return null;

  return (
    <div className={`next-action is-${NEXT_ACTION_TONE[action.kind]}`} role="status">
      <div className="next-action__text">
        <span className="next-action__label">Suggested next step</span>
        <span className="next-action__value">{action.label}</span>
        <span className="next-action__reason">{action.reason}</span>
      </div>

      <div className="next-action__controls">
        {canAct && action.actionLabel && action.targetStage && (
          <button
            type="button"
            className="button is-small is-outlined-primary"
            onClick={() => onAct(action.targetStage as string)}
          >
            {action.actionLabel}
          </button>
        )}
        <button
          type="button"
          className="next-action__dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss this suggestion"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
