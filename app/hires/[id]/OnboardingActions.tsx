"use client";

// =============================================================================
// Complete, hold, and reassign.
//
// THE COMPLETE BUTTON IS DISABLED WITH ITS REASON ATTACHED. The spec asks for a
// tooltip explaining what is still missing "if clicked too early" — but a
// disabled button cannot be clicked, so a click-triggered explanation would
// never appear. The reason is therefore always visible next to the button, and
// also on the title attribute for a pointer user. Naming the blockers is the
// whole point; "not yet" with no explanation is what makes someone file a bug.
//
// The gate is re-checked server-side in PATCH /api/onboarding/[id]. This is the
// courtesy; that is the rule.
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PauseCircle, PlayCircle } from "lucide-react";
import { FormError } from "@/components/states";
import { blockerSummary, type CompletionCheck, type OnboardingStatus } from "@/lib/onboarding/documents";

export function OnboardingActions({
  recordId,
  status,
  completion,
  canManage,
  canReassign,
  members,
  assignedTo,
}: {
  recordId: string;
  status: OnboardingStatus;
  completion: CompletionCheck;
  canManage: boolean;
  /** Owner/Admin only — reassigning is a workload change somebody agreed to. */
  canReassign: boolean;
  members: { id: string; name: string }[];
  assignedTo: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/onboarding/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save that change.");
      return;
    }
    router.refresh();
  }

  if (!canManage) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        {status === "completed"
          ? "This onboarding is complete."
          : "Your role can view this onboarding but not change it."}
      </p>
    );
  }

  const blockers = blockerSummary(completion.blockers);

  return (
    <>
      <FormError message={error} />

      <div className="is-flex" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
        {status !== "completed" ? (
          <button
            type="button"
            className={`button is-primary is-small ${busy ? "is-loading" : ""}`}
            disabled={busy || !completion.canComplete}
            title={blockers ?? "All required documents are verified."}
            onClick={() => patch({ status: "completed" })}
          >
            <CheckCircle2 size={14} aria-hidden="true" />
            Mark onboarding complete
          </button>
        ) : (
          <button
            type="button"
            className={`button is-small ${busy ? "is-loading" : ""}`}
            disabled={busy}
            onClick={() => patch({ status: "in_progress" })}
          >
            <PlayCircle size={14} aria-hidden="true" />
            Reopen onboarding
          </button>
        )}

        {status === "in_progress" && (
          <button
            type="button"
            className={`button is-small ${busy ? "is-loading" : ""}`}
            disabled={busy}
            onClick={() => patch({ status: "on_hold" })}
            title="Pause without abandoning it — a delayed start date, for example."
          >
            <PauseCircle size={14} aria-hidden="true" />
            Put on hold
          </button>
        )}

        {status === "on_hold" && (
          <button
            type="button"
            className={`button is-small ${busy ? "is-loading" : ""}`}
            disabled={busy}
            onClick={() => patch({ status: "in_progress" })}
          >
            <PlayCircle size={14} aria-hidden="true" />
            Resume
          </button>
        )}
      </div>

      {/* Always visible, not only on hover: a disabled button cannot be clicked,
          so a click- or hover-only explanation reaches nobody on a touch screen. */}
      {status !== "completed" && blockers && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 13 }}>
          Can&apos;t complete yet — {blockers}
        </p>
      )}

      {status === "on_hold" && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 13 }}>
          On hold. Documents can still be uploaded and verified; overdue reminders are paused.
        </p>
      )}

      {canReassign && (
        <div className="field mt-4 mb-0" style={{ maxWidth: 280 }}>
          <label className="label" style={{ fontSize: 12 }} htmlFor="onboarding-assignee-select">
            Assigned to
          </label>
          <div className="select is-small is-fullwidth">
            <select
              id="onboarding-assignee-select"
              value={assignedTo ?? ""}
              disabled={busy}
              onChange={(event) =>
                patch({ assigned_to: event.target.value === "" ? null : event.target.value })
              }
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <p className="help has-text-secondary">
            Overdue-document reminders go to this person. Unassigned records get none.
          </p>
        </div>
      )}
    </>
  );
}
