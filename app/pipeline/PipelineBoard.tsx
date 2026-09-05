"use client";

// The Kanban board.
//
// Button-based stage moves rather than drag-and-drop: the spec allows either,
// and a dropdown is keyboard-accessible, works on a phone, and cannot fire from
// a mis-drag. Moving someone through a hiring pipeline should be deliberate.
//
// Terminal outcomes (rejected/withdrawn) are shown as exit counts, not columns —
// otherwise the board fills with finished work and stops being a work queue.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState, FormError } from "@/components/states";
import { availableTransitions, STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";
import { slaColor } from "@/lib/pipeline/sla";
import type { Board, BoardCard } from "@/lib/pipeline/queries";
import { PHASE_LABELS, phaseOf } from "@/lib/applications/phase";

function Card({
  card,
  canMove,
  onMove,
  onReverseScreen,
  busy,
}: {
  card: BoardCard;
  canMove: boolean;
  onMove: (id: string, stage: ApplicationStage) => void;
  /** MODULE 25. Clears the automatic Not Shortlisted flag. */
  onReverseScreen: (id: string) => void;
  busy: boolean;
}) {
  const accent = slaColor(card.sla.status);

  return (
    <div
      className="card mb-3"
      style={{
        padding: "12px",
        // A left rule rather than a filled background: readable, and it keeps
        // the flat card style.
        borderLeft: accent ? `3px solid ${accent}` : undefined,
      }}
    >
      <Link href={`/applications/${card.id}`} style={{ fontWeight: 600, fontSize: 14 }}>
        {card.candidateName}
      </Link>
      <p className="has-text-secondary" style={{ fontSize: 12 }}>
        {card.jobTitle}
      </p>

      <div className="is-flex is-align-items-center mt-2" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        {card.matchScore !== null && (
          <span className="tag is-light" style={{ fontSize: 11 }}>
            {Math.round(card.matchScore)}% match
          </span>
        )}
        <span style={{ fontSize: 11, color: accent ?? "var(--color-text-secondary)" }}>
          {card.sla.label}
        </span>
      </div>

      {/* The spec's headline attention signal. */}
      {card.awaitingScreeningReview && (
        <Link
          href={`/applications/${card.id}/screening-report`}
          className="tag mt-2"
          style={{
            background: "var(--status-attention-bg)",
            color: "var(--status-attention-text)",
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          screening report to review
        </Link>
      )}

      {/*
        MODULE 25 — the automatic screen-out, shown ON the card.

        Deliberately NOT styled as an error. A failed resume screen is a first
        pass by a threshold, not a verdict, and painting it red would train
        recruiters to treat it as one. It carries the two numbers so the decision
        is checkable at a glance, and a reversal is one click away — which is the
        brief's "visible and reversible" requirement made concrete.
      */}
      {card.notShortlisted && (
        <div
          className="mt-2"
          style={{
            background: "var(--status-attention-bg)",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--status-attention-text)" }}>
            Not shortlisted by the resume screen
          </p>
          {card.notShortlisted.score !== null && card.notShortlisted.threshold !== null && (
            <p className="has-text-secondary" style={{ fontSize: 11 }}>
              Scored {Math.round(card.notShortlisted.score)} against a mark of{" "}
              {Math.round(card.notShortlisted.threshold)}.
            </p>
          )}
          {canMove && (
            <button
              type="button"
              className="button is-small is-ghost mt-1"
              style={{ padding: 0, height: "auto", fontSize: 11, textDecoration: "underline" }}
              disabled={busy}
              onClick={() => onReverseScreen(card.id)}
            >
              Reverse this
            </button>
          )}
        </div>
      )}

      {canMove && (
        <div className="select is-small is-fullwidth mt-2">
          <select
            value=""
            disabled={busy}
            aria-label={`Move ${card.candidateName} to another stage`}
            onChange={(event) => {
              if (event.target.value) onMove(card.id, event.target.value as ApplicationStage);
            }}
          >
            <option value="">Move to…</option>
            {availableTransitions(card.stage).map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function PipelineBoard({
  board,
  canMove,
}: {
  board: Board;
  canMove: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * MODULE 25 — undo an automatic screen-out.
   *
   * A DELETE on the flag rather than a stage move, because the failed screen
   * never moved the application: it is sitting in Applied with a marker on it.
   * That is what makes the reversal a single call with nothing to unwind.
   */
  async function reverseScreen(applicationId: string) {
    setBusyId(applicationId);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}/shortlist`, {
      method: "DELETE",
    });

    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not reverse that screening decision.");
      return;
    }
    router.refresh();
  }

  async function move(applicationId: string, stage: ApplicationStage) {
    setBusyId(applicationId);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });

    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not move that application.");
      return;
    }
    // The stage-history row is written by Module 5's database trigger, so
    // nothing here needs to record the transition.
    router.refresh();
  }

  if (board.totalCards === 0) {
    return (
      <div className="card">
        <EmptyState
          message="Nothing in the pipeline yet. Link a candidate to a job to start one."
          action={
            <Link className="button is-primary" href="/applications/new">
              New application
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <FormError message={error} />

      {/* Horizontal scroll rather than squeezing columns: a Kanban board is one
          of the few tables that genuinely cannot collapse to a phone width. */}
      <div style={{ overflowX: "auto", paddingBottom: "1rem" }}>
        <div className="is-flex" style={{ gap: "1rem", minWidth: "min-content" }}>
          {board.columns.map((column) => (
            <div key={column.stage} style={{ minWidth: 260, width: 260, flexShrink: 0 }}>
              <div className="is-flex is-justify-content-space-between is-align-items-center mb-2">
                <p style={{ fontSize: 13, fontWeight: 600 }}>{STAGE_LABELS[column.stage]}</p>
                {/* The coarse grouping above the stage — derived, never stored. */}
                <p className="pipeline-phase">{PHASE_LABELS[phaseOf(column.stage)]}</p>
                <span className="has-text-secondary" style={{ fontSize: 12 }}>
                  {column.cards.length}
                </span>
              </div>

              {column.cards.length === 0 ? (
                <p
                  className="has-text-secondary"
                  style={{ fontSize: 12, padding: "12px 0" }}
                >
                  Empty
                </p>
              ) : (
                column.cards.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    canMove={canMove}
                    onMove={move}
                    onReverseScreen={reverseScreen}
                    busy={busyId === card.id}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      </div>

      {board.exits.some((exit) => exit.count > 0) && (
        <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
          Also{" "}
          {board.exits
            .filter((exit) => exit.count > 0)
            .map((exit) => `${exit.count} ${STAGE_LABELS[exit.stage].toLowerCase()}`)
            .join(", ")}{" "}
          — closed, so not shown on the board.
        </p>
      )}
    </div>
  );
}
