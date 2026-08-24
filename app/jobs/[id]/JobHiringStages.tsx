"use client";

// =============================================================================
// Hiring stages, on the job page.
//
// WHAT WAS ACTUALLY WRONG: this card rendered `if (!stage?.enabled) return null`
// inside a section that only appeared at all when something was already on. On a
// job with all four stages off it therefore showed a heading, a helper line and
// nothing else — and once Resume Score existed and defaulted to on, it showed
// that single unrelated row. The four stages were never missing from the data;
// they were filtered out of the view. All four now render always, on or off,
// because "which stages does this job run?" is a question about all four and the
// answer "none of them" is a real answer that has to be visible.
//
// Toggling here writes, so it is a client component — but with an EXPLICIT SAVE,
// never on flip. The design system is unambiguous ("Config edits use an explicit
// Save, never silent auto-save"), and a switch that saved on touch would let a
// mis-click change what candidates go through with no undo and no confirmation.
//
// IT TOGGLES, IT DOES NOT CONFIGURE. Scripts, questions, durations and pass
// marks stay on the edit page, which is the one place they are authored and the
// one place their Save lives. "Configure" links there rather than opening a
// second copy of that editor — two editors for one script is how they drift.
//
// Only `enabled` is changed. prompt_template and config are sent back exactly as
// they arrived, so a stage switched off here keeps the script someone wrote, and
// the PUT touches only the stages it is sent — Resume Score is not in this list
// and is not disturbed by saving from here.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Toggle } from "@/components/ui/Toggle";
import { FormError } from "@/components/states";
import { CONFIGURATION_ONLY_NOTE, type StageKey } from "@/lib/hiring-stages/catalog";
import type { StageConfig } from "@/lib/hiring-stages/config";

export type PipelineStageRow = {
  key: StageKey;
  label: string;
  description: string;
  /** "live" stages run through a real engine; the rest are configuration only. */
  live: boolean;
  engine: string | null;
  enabled: boolean;
  /** Round-tripped untouched so a save here cannot discard a script. */
  promptTemplate: string | null;
  config: StageConfig;
  /** Whether a script has been written, for the row's secondary line. */
  configured: boolean;
};

export function JobHiringStages({
  jobId,
  stages,
  canEdit,
}: {
  jobId: string;
  stages: PipelineStageRow[];
  /** Viewer: every row renders, nothing accepts input. */
  canEdit: boolean;
}) {
  const router = useRouter();

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(stages.map((stage) => [stage.key, stage.enabled]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived, not stored: toggling a row back to where it started leaves the
  // card clean again, rather than nagging about a change that no longer exists.
  const dirty = stages.some((stage) => enabled[stage.key] !== stage.enabled);

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/jobs/${jobId}/hiring-stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stages: stages.map((stage) => ({
            stage_key: stage.key,
            enabled: enabled[stage.key],
            // Unchanged. This card owns one boolean per row and nothing else.
            prompt_template: stage.promptTemplate,
            config: stage.config,
          })),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not save the hiring stages.");
        return;
      }

      // Server-rendered page: the saved state only becomes the state this card
      // compares against after the page re-reads it.
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <div className="job-card__head">
        <div>
          <h2 className="job-card__title">Hiring stages</h2>
          <p className="job-card__subtitle">
            What candidates for this role go through. Switch a stage on or off here; scripts and
            questions are edited in its configuration.
          </p>
        </div>
      </div>

      <FormError message={error} />

      <ul className="stage-list">
        {stages.map((stage) => (
          <li key={stage.key} className="stage-row">
            <div className="stage-row__text">
              <p className="stage-row__name" id={`job-stage-${stage.key}`}>
                {stage.label}
              </p>
              <p className="stage-row__description">{stage.description}</p>

              {/* Says plainly that three of these cannot run yet, so nobody
                  switches one on and waits for something to happen. */}
              {!stage.live && <span className="stage-row__note">{CONFIGURATION_ONLY_NOTE}</span>}
              {stage.live && enabled[stage.key] && (
                <span className="stage-row__note is-live">Runs through {stage.engine}</span>
              )}
              {enabled[stage.key] && !stage.configured && (
                <span className="stage-row__note">No script written yet</span>
              )}
            </div>

            <div className="stage-row__controls">
              {/* Configure stays available while a stage is on, and the link is
                  the only route to the editor — never a second copy of it. */}
              {enabled[stage.key] && (
                <Link className="text-link" href={`/jobs/${jobId}/edit`}>
                  <Settings2 size={14} aria-hidden="true" />
                  {canEdit ? "Configure" : "View"}
                </Link>
              )}

              <Toggle
                checked={enabled[stage.key]}
                disabled={!canEdit || saving}
                labelledBy={`job-stage-${stage.key}`}
                onChange={(next) =>
                  setEnabled((current) => ({ ...current, [stage.key]: next }))
                }
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Explicit save, with the unsaved-changes indicator the design system
          asks for. Absent entirely for a Viewer, who cannot change a row. */}
      {canEdit && (
        <div className="job-card__foot">
          <p className="job-card__hint">
            {dirty ? "You have unsaved changes." : "No unsaved changes."}
          </p>
          <button
            type="button"
            className={`button is-primary is-small ${saving ? "is-loading" : ""}`}
            onClick={save}
            disabled={!dirty || saving}
          >
            Save changes
          </button>
        </div>
      )}
    </section>
  );
}
