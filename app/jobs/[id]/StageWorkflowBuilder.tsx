"use client";

// =============================================================================
// The Stage Workflow Builder.
//
// One expandable row per pipeline stage. Expanding shows that stage's ordered
// action list — or its On Pass / On Fail lists, where the stage has a verdict —
// and every save writes a real `automations` row that the Module 13 Automations
// page lists and the Module 13 engine executes.
//
// -----------------------------------------------------------------------------
// THIS IS A SECOND EDITOR, NOT A SECOND SYSTEM.
//
// The distinction is worth stating because the two are easy to confuse and the
// consequences differ completely. A second SYSTEM would mean another table,
// another executor and another run history — four things to keep in step with
// Module 13 forever. A second EDITOR means the same rows, reached from the place
// they are about.
//
// Everything configured here therefore shows up on /automations with its run
// history, exactly as the brief requires. The reverse is not true and does not
// need to be: a hand-written org-wide rule has no stage row to appear on.
//
// -----------------------------------------------------------------------------
// EXPLICIT SAVE, PER LIST.
//
// The design system is unambiguous ("Config edits use an explicit Save, never
// silent auto-save"), and this screen has the strongest version of the reason: a
// mis-drop while reordering could otherwise change what a candidate is sent.
//
// Save is per LIST rather than per screen, matching the API. A whole-screen save
// would have to report "3 of 11 stages failed" and leave the user to work out
// which three.
// =============================================================================

import type { PlaceholderField } from "@/lib/hiring-stages/placeholders";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { EmptyState, FormError } from "@/components/states";
import { WorkflowActionEditor } from "./WorkflowActionEditor";
import { ACTION_LABELS, type Action } from "@/lib/automations/catalog";
import { describeRecipients, recipientsFrom } from "@/lib/workflow/recipients";
import { BRANCH_LABELS, NO_BRANCH_NOTE, type WorkflowBranch } from "@/lib/workflow/stages";
import type { ApplicationStage } from "@/lib/applications/stages";
import type { WorkflowOptions } from "@/lib/workflow/options";

export type BuilderList = {
  stage: ApplicationStage;
  branch: WorkflowBranch;
  automationId: string | null;
  status: "draft" | "active" | "paused";
  actions: Action[];
  pausedReason: string | null;
};

export type BuilderStage = {
  stage: ApplicationStage;
  label: string;
  branches: WorkflowBranch[];
  scoreSource: string | null;
  lists: BuilderList[];
};

export function StageWorkflowBuilder({
  jobId,
  stages,
  options: initialOptions,
  canEdit,
  customFields = [],
}: {
  jobId: string;
  stages: BuilderStage[];
  options: WorkflowOptions;
  /** Owner/Admin. A Recruiter or Viewer reads the same rows, with no controls. */
  canEdit: boolean;
  /** MODULE 27 — forwarded to each action's message editor. */
  customFields?: PlaceholderField[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [options, setOptions] = useState(initialOptions);

  /**
   * Local edits, keyed by `stage:branch`, holding ONLY lists somebody has
   * touched.
   *
   * Not a copy of every list. Seeding state from all of them would mean a save
   * on one stage re-sending the server's version of another, silently
   * overwriting whatever a colleague changed in between.
   */
  const [drafts, setDrafts] = useState<Record<string, Action[]>>({});

  function listFor(list: BuilderList): Action[] {
    return drafts[`${list.stage}:${list.branch}`] ?? list.actions;
  }

  function setList(list: BuilderList, actions: Action[]) {
    setDrafts((current) => ({ ...current, [`${list.stage}:${list.branch}`]: actions }));
  }

  function clearDraft(list: BuilderList) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[`${list.stage}:${list.branch}`];
      return next;
    });
  }

  const configuredCount = stages.reduce(
    (total, stage) => total + stage.lists.filter((list) => list.actions.length > 0).length,
    0
  );

  return (
    <section className="card mb-5">
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-1">
        <div>
          <h2 className="title is-6 mb-1">Stage workflow</h2>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            What happens automatically when an application reaches each stage.
          </p>
        </div>
        <Link className="button is-small" href="/automations">
          Run history
        </Link>
      </div>

      <p className="has-text-secondary mb-4" style={{ fontSize: 12 }}>
        {configuredCount === 0
          ? "Nothing is configured yet — every stage is silent until you add an action."
          : `${configuredCount} list${configuredCount === 1 ? "" : "s"} configured. Everything here also appears on the Automations page.`}
      </p>

      {stages.map((stage) => {
        const isOpen = expanded === stage.stage;
        const total = stage.lists.reduce((count, list) => count + listFor(list).length, 0);

        return (
          <div
            key={stage.stage}
            style={{ borderTop: "1px solid var(--color-border)", padding: "12px 0" }}
          >
            <button
              type="button"
              className="button is-ghost is-fullwidth is-justify-content-space-between"
              style={{ padding: 0, height: "auto", textAlign: "left" }}
              onClick={() => setExpanded(isOpen ? null : stage.stage)}
              aria-expanded={isOpen}
            >
              <span className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span style={{ fontWeight: 600, fontSize: 14 }}>{stage.label}</span>
              </span>
              <span className="has-text-secondary" style={{ fontSize: 12 }}>
                {total === 0 ? "No actions" : `${total} action${total === 1 ? "" : "s"}`}
              </span>
            </button>

            {isOpen && (
              <div className="mt-3">
                {stage.scoreSource ? (
                  <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
                    Pass and fail are decided by {stage.scoreSource}.
                  </p>
                ) : (
                  <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
                    {NO_BRANCH_NOTE}
                  </p>
                )}

                {stage.lists.map((list) => (
                  <BranchList
                    key={`${list.stage}:${list.branch}`}
                    jobId={jobId}
                    list={list}
                    actions={listFor(list)}
                    dirty={drafts[`${list.stage}:${list.branch}`] !== undefined}
                    options={options}
                    canEdit={canEdit}
                    customFields={customFields}
                    showBranchHeading={stage.branches.length > 1}
                    onChange={(actions) => setList(list, actions)}
                    onSaved={() => clearDraft(list)}
                    onOptionsChanged={(patch) =>
                      setOptions((current) => ({ ...current, ...patch }))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function BranchList({
  jobId,
  list,
  actions,
  dirty,
  options,
  canEdit,
  customFields,
  showBranchHeading,
  onChange,
  onSaved,
  onOptionsChanged,
}: {
  jobId: string;
  list: BuilderList;
  actions: Action[];
  dirty: boolean;
  options: WorkflowOptions;
  canEdit: boolean;
  customFields: PlaceholderField[];
  showBranchHeading: boolean;
  onChange: (actions: Action[]) => void;
  onSaved: () => void;
  onOptionsChanged: (patch: Partial<WorkflowOptions>) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(activate: boolean) {
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/jobs/${jobId}/workflow`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: list.stage,
        branch: list.branch,
        actions,
        activate,
      }),
    });

    setSaving(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "That couldn't be saved.");
      return;
    }

    onSaved();
    setEditing(null);
    router.refresh();
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= actions.length) return;
    const next = [...actions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="mb-4" style={{ paddingLeft: showBranchHeading ? 12 : 0 }}>
      {showBranchHeading && (
        <p className="label is-small mb-2" style={{ marginBottom: 4 }}>
          {BRANCH_LABELS[list.branch]}
        </p>
      )}

      {actions.length === 0 ? (
        <EmptyState
          compact
          headline="Nothing happens here yet"
          message={
            list.branch === "fail"
              ? "Add an action to say what happens when somebody doesn't make it through — a polite email, or a note for the recruiter."
              : "Add an action to make this stage do something automatically."
          }
        />
      ) : (
        actions.map((action, index) =>
          editing === index ? (
            <WorkflowActionEditor
              key={index}
              customFields={customFields}
              action={action}
              stage={list.stage}
              options={options}
              onChange={(next) => {
                const list = [...actions];
                list[index] = next;
                onChange(list);
              }}
              onOptionsChanged={onOptionsChanged}
              onRemove={() => {
                onChange(actions.filter((_, position) => position !== index));
                setEditing(null);
              }}
            />
          ) : (
            <ActionCard
              key={index}
              action={action}
              index={index}
              total={actions.length}
              options={options}
              canEdit={canEdit}
              onEdit={() => setEditing(index)}
              onMove={(direction) => move(index, direction)}
            />
          )
        )
      )}

      {canEdit && (
        <div className="is-flex is-align-items-center mt-2" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="button is-small"
            onClick={() => {
              onChange([
                ...actions,
                {
                  type: "send_templated_message",
                  config: { recipients: [{ kind: "candidate" }], manual: false },
                },
              ]);
              setEditing(actions.length);
            }}
          >
            <Plus size={13} /> <span className="ml-1">Add action</span>
          </button>

          {dirty && (
            <>
              <button
                type="button"
                className={`button is-small is-primary ${saving ? "is-loading" : ""}`}
                onClick={() => save(true)}
                disabled={saving}
              >
                Save &amp; activate
              </button>
              <button
                type="button"
                className="button is-small"
                onClick={() => save(false)}
                disabled={saving}
              >
                Save as draft
              </button>
            </>
          )}

          {!dirty && list.automationId && (
            <span
              className="tag is-light"
              style={{
                fontSize: 11,
                color:
                  list.status === "active" ? "var(--color-success)" : "var(--color-text-secondary)",
              }}
            >
              {list.status === "active" ? "Live" : list.status === "paused" ? "Paused" : "Draft"}
            </span>
          )}
        </div>
      )}

      {list.pausedReason && (
        <p className="mt-2" style={{ fontSize: 12, color: "var(--color-warning)" }}>
          {list.pausedReason}
        </p>
      )}

      {error && <FormError message={error} />}
    </div>
  );
}

/** The compact, non-editing view of one action. */
function ActionCard({
  action,
  index,
  total,
  options,
  canEdit,
  onEdit,
  onMove,
}: {
  action: Action;
  index: number;
  total: number;
  options: WorkflowOptions;
  canEdit: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const config = action.config ?? {};

  const memberNames = new Map(options.members.map((member) => [member.userId, member.name]));

  const target =
    typeof config.template_id === "string"
      ? options.templates.find((template) => template.id === config.template_id)?.name
      : typeof config.agent_id === "string"
        ? options.agents.find((agent) => agent.id === config.agent_id)?.name
        : null;

  const form =
    typeof config.form_id === "string"
      ? options.forms.find((entry) => entry.id === config.form_id)?.name
      : null;

  const showsRecipients =
    action.type === "send_templated_message" || action.type === "request_form";

  return (
    <div
      className="card mb-2 is-flex is-align-items-center is-justify-content-space-between"
      style={{ padding: "10px 12px", gap: "0.75rem" }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 13 }}>
          {ACTION_LABELS[action.type]}
          {config.manual === true && (
            <span className="tag is-light ml-2" style={{ fontSize: 10 }}>
              Manual
            </span>
          )}
        </p>
        <p className="has-text-secondary" style={{ fontSize: 12 }}>
          {[
            form,
            target,
            showsRecipients ? `to ${describeRecipients(recipientsFrom(config), memberNames)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Not configured yet"}
        </p>
      </div>

      {canEdit && (
        <div className="is-flex" style={{ gap: "0.25rem" }}>
          <button
            type="button"
            className="button is-small is-ghost"
            aria-label="Move earlier"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="button is-small is-ghost"
            aria-label="Move later"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={13} />
          </button>
          <button type="button" className="button is-small" onClick={onEdit}>
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
