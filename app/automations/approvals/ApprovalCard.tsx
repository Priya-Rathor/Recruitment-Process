"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import { ACTION_LABELS, CANDIDATE_CONTACT_ACTIONS, type Action } from "@/lib/automations/catalog";
import type { ActionResult } from "@/lib/automations/engine";

/**
 * One proposal, and the decision.
 *
 * WHAT IT SHOWS AND WHY. The actions listed here are the SNAPSHOT taken when the
 * rule matched, not the rule's current actions — so approving means approving
 * what is on the screen even if somebody edited the rule since. Saying so in
 * plain words matters, because "approve" otherwise looks like it means "let that
 * rule run", which is a subtly different and much broader thing.
 *
 * REJECT IS NOT DESTRUCTIVE and is not styled as though it were. Declining is
 * the expected outcome much of the time; making it look dangerous would push
 * people toward approving out of caution, which is the opposite of oversight.
 */
export function ApprovalCard({
  approval,
  canDecide,
  /**
   * template id -> name, for any "Send templated message" action in this proposal.
   *
   * Resolved on the server and passed down rather than fetched here: an approval
   * card is rendered dozens at a time, and a fetch per card would be a request
   * storm for a label.
   */
  templateNames = {},
}: {
  approval: {
    id: string;
    automation_id: string;
    automation_name: string;
    application_id: string;
    candidate_name: string | null;
    job_title: string | null;
    actions: Action[];
    summary: string;
    expires_at: string;
    created_at: string;
  };
  canDecide: boolean;
  templateNames?: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<{
    status: string;
    results: ActionResult[];
  } | null>(null);

  const contactsCandidate = approval.actions.some((action) =>
    CANDIDATE_CONTACT_ACTIONS.includes(action.type)
  );

  const expiresAt = new Date(approval.expires_at);
  const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));

  async function decide(decision: "approved" | "rejected") {
    setBusy(decision);
    setError(null);

    try {
      const response = await fetch(`/api/automations/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || null }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't record that decision.");
        return;
      }

      // The per-action outcome is shown rather than a bare "done". An approval
      // whose actions then failed is a real and important case: the person
      // authorised it, and the system did not manage it.
      setOutcome({
        status: payload.data.status,
        results: (payload.data.action_results ?? []) as ActionResult[],
      });
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (outcome) {
    const failed = outcome.results.filter((result) => result.status === "failed");

    return (
      <div
        className="card mb-3"
        style={{
          borderColor: failed.length > 0 ? "var(--color-error)" : "var(--color-border)",
        }}
      >
        <p style={{ fontSize: 14 }}>
          <strong>
            {outcome.status === "rejected"
              ? "Declined."
              : failed.length > 0
                ? "Approved, but not everything worked."
                : "Approved and done."}
          </strong>{" "}
          {approval.automation_name} · {approval.candidate_name ?? "an application"}
        </p>

        {outcome.results.length > 0 && (
          <ul className="mt-2 has-text-secondary" style={{ fontSize: 13 }}>
            {outcome.results.map((result, index) => (
              <li key={index}>
                {ACTION_LABELS[result.action] ?? result.action}: {result.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="card mb-3">
      <div
        className="is-flex is-justify-content-space-between mb-2"
        style={{ gap: "1rem", flexWrap: "wrap" }}
      >
        <div>
          <p style={{ fontSize: 15, fontWeight: 600 }}>
            <Link href={`/automations/${approval.automation_id}`}>{approval.automation_name}</Link>
          </p>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            <Link href={`/applications/${approval.application_id}`}>
              {approval.candidate_name ?? "An application"}
            </Link>
            {approval.job_title ? ` · ${approval.job_title}` : ""}
          </p>
        </div>

        <p
          className="has-text-secondary"
          style={{
            fontSize: 12,
            whiteSpace: "nowrap",
            color: hoursLeft < 24 ? "var(--color-warning)" : undefined,
          }}
        >
          {hoursLeft <= 0
            ? "Expired"
            : hoursLeft < 48
              ? `Expires in ${hoursLeft}h`
              : `Expires in ${Math.round(hoursLeft / 24)} days`}
        </p>
      </div>

      <p className="mb-2" style={{ fontSize: 14 }}>
        {approval.summary}
      </p>

      <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
        Approving runs exactly these, on this one application:
      </p>
      <ul className="mb-3" style={{ fontSize: 14, marginLeft: "1.1rem", listStyle: "disc" }}>
        {approval.actions.map((action, index) => (
          <li key={index}>
            {ACTION_LABELS[action.type] ?? action.type}
            {/*
              NAME THE TEMPLATE. "Send templated message" alone asks somebody to
              approve wording they cannot see, which is not oversight — it is a
              rubber stamp with extra steps. The name is resolved server-side and
              passed in; an unresolvable id says so rather than showing a UUID.
            */}
            {action.type === "send_templated_message" && (
              <>
                {" — "}
                {templateNames[String(action.config?.template_id ?? "")] ? (
                  <>
                    “{templateNames[String(action.config?.template_id ?? "")]}”
                    {" ("}
                    <Link href="/settings/templates">read the wording</Link>
                    {")"}
                  </>
                ) : (
                  <span style={{ color: "var(--status-attention-text, #B45309)" }}>
                    the template it named has since been deleted, so this will not send
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {contactsCandidate && (
        <p className="mb-3" style={{ fontSize: 13, color: "var(--status-attention-text, #B45309)" }}>
          This one reaches the candidate directly. Once approved it cannot be recalled.
        </p>
      )}

      <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
        These are the actions as they were when the rule matched. If somebody has edited the rule
        since, approving still does what is listed here — not what the rule says now.
      </p>

      <FormError message={error} />

      {canDecide ? (
        <>
          <input
            className="input is-small mb-2"
            style={{ maxWidth: 420 }}
            placeholder="Optional note — why you decided this way"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />

          <div className="is-flex" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            {confirming ? (
              <>
                <button
                  type="button"
                  className={`button is-small is-primary ${busy === "approved" ? "is-loading" : ""}`}
                  onClick={() => decide("approved")}
                  disabled={busy !== null}
                >
                  Yes, run these actions
                </button>
                <button
                  type="button"
                  className="button is-small"
                  onClick={() => setConfirming(false)}
                  disabled={busy !== null}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`button is-small is-primary ${
                  busy === "approved" && !contactsCandidate ? "is-loading" : ""
                }`}
                onClick={() => (contactsCandidate ? setConfirming(true) : decide("approved"))}
                disabled={busy !== null}
              >
                Approve
              </button>
            )}

            <button
              type="button"
              className={`button is-small ${busy === "rejected" ? "is-loading" : ""}`}
              onClick={() => decide("rejected")}
              disabled={busy !== null}
            >
              Decline
            </button>
          </div>
        </>
      ) : (
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Only an Owner or Admin can decide this one.
        </p>
      )}
    </div>
  );
}
