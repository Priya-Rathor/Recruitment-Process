"use client";

// =============================================================================
// One action, being edited.
//
// -----------------------------------------------------------------------------
// THE "+ NEW X" RULE, WHICH IS THE POINT OF THIS COMPONENT.
//
// The brief is explicit: "Do not duplicate the message template, agent, or form
// creation flows — every '+ New X' inline action opens the SAME existing editor
// as a modal, saves through the same API, and simply returns the new item as
// selected in this builder."
//
// So:
//   - "+ New template" renders app/settings/templates/TemplateEditor.tsx. Not a
//     copy of it, not a cut-down version — the component itself, with its
//     placeholder picker, its channel handling and its preview. It saves through
//     POST /api/settings/message-templates, the same endpoint the settings page
//     uses.
//   - "+ New form" POSTs to /api/forms, the same endpoint the Forms page uses.
//   - "+ New agent" POSTs to /api/settings/voice-agents, the same endpoint the
//     Voice Agent Console uses.
//
// The two POST flows ask only for a NAME here, and then link to the full editor.
// That is not a cut-down duplicate: creating a form or an agent through those
// endpoints genuinely takes only a name (the rest is defaulted and edited
// afterwards), which is exactly what their own pages do. Reproducing the field
// editor or the agent persona editor inline WOULD have been a duplicate, and is
// the thing the brief rules out.
//
// -----------------------------------------------------------------------------
// WHY THE NEW ITEM APPEARS WITHOUT A RELOAD.
//
// `onCreated` pushes the created row into the parent's local option list and
// selects it immediately. router.refresh() is fired as well so the server
// component's copy catches up, but the selection does not wait for it — the
// spec's test is "correctly saves and becomes selectable without a page
// reload", and a refresh round trip is a reload from the user's point of view.
// =============================================================================
import type { PlaceholderField } from "@/lib/hiring-stages/placeholders";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { FormError } from "@/components/states";
import { TemplateEditor } from "@/app/settings/templates/TemplateEditor";
import {
  ACTION_LABELS,
  ACTION_STAGE_RESTRICTIONS,
  actionRunsIn,
  isManualOnly,
  OFFERED_ACTIONS,
  type Action,
  type ActionType,
} from "@/lib/automations/catalog";
import {
  DELAY_BASES,
  DELAY_BASIS_LABELS,
  describeDelay,
  isDelayBasis,
} from "@/lib/workflow/delay";
import {
  MAX_RECIPIENTS,
  RECIPIENT_HINTS,
  RECIPIENT_KINDS,
  RECIPIENT_LABELS,
  recipientsFrom,
  type Recipient,
  type RecipientKind,
} from "@/lib/workflow/recipients";
import {
  APPLICATION_STAGES,
  STAGE_LABELS,
  type ApplicationStage,
} from "@/lib/applications/stages";
import type {
  AgentOption,
  FormOption,
  MemberOption,
  TemplateOption,
  WorkflowOptions,
} from "@/lib/workflow/options";

/** Actions whose config includes a recipient list. */
const RECIPIENT_ACTIONS: ActionType[] = ["send_templated_message", "request_form"];

/**
 * Actions this builder offers, in the order the brief lists them.
 *
 * A SUBSET of OFFERED_ACTIONS, not a replacement for it. Module 13's builder
 * still offers everything; this one leads with the six the brief names because a
 * stage-centric screen is used by recruiters rather than by whoever writes
 * When/If/Then rules, and a list of eleven actions starting with "Generate the
 * screening report" is a list nobody reads to the end.
 *
 * Everything not in this list is still reachable from the Automations page and
 * still executes here — an action added there appears on this screen as a card
 * like any other. It is a display order, not a permission.
 */
const BUILDER_ACTION_ORDER: ActionType[] = [
  "send_templated_message",
  "wait_then",
  "start_screening_call",
  "request_form",
  "schedule_interview",
  "ai_resume_shortlist",
  "move_to_stage",
  "assign_recruiter",
  "add_note",
  "notify_recruiter",
];

function offeredFor(stage: ApplicationStage, nested = false): ActionType[] {
  const ordered = [
    ...BUILDER_ACTION_ORDER.filter((action) => OFFERED_ACTIONS.includes(action)),
    ...OFFERED_ACTIONS.filter((action) => !BUILDER_ACTION_ORDER.includes(action)),
  ];

  // The stage restriction is enforced again on the server (lib/workflow/
  // queries.ts). Filtering here is so the option never appears where it cannot
  // be used — an error after the fact would be a worse way to learn the rule.
  return ordered.filter((action) => {
    const allowed = ACTION_STAGE_RESTRICTIONS[action];
    if (allowed && !allowed.includes(stage)) return false;

    /**
     * Inside a wait, only what the SCHEDULER can run.
     *
     * The queue is drained by the sweep under the service-role client, so a
     * session-only action queued here would be denied by RLS half an hour later
     * with nobody watching. validateRule() refuses it too; this stops it being
     * offered in the first place, which is a better way to learn the rule than
     * an error on save.
     */
    if (nested) {
      if (action === "wait_then") return false;
      if (!actionRunsIn(action, "service")) return false;
      if (isManualOnly(action)) return false;
    }

    return true;
  });
}

export function WorkflowActionEditor({
  action,
  stage,
  options,
  nested = false,
  onChange,
  onOptionsChanged,
  onRemove,
  customFields = [],
}: {
  action: Action;
  stage: ApplicationStage;
  options: WorkflowOptions;
  /**
   * True when this action sits inside a "Wait, then…".
   *
   * Narrows the type picker: no wait inside a wait (the catalogue refuses it),
   * and nothing manual (a scheduled action that waits for a click is two
   * contradictory instructions).
   */
  nested?: boolean;
  onChange: (next: Action) => void;
  /** Adds a newly created template/form/agent to the live option list. */
  onOptionsChanged: (patch: Partial<WorkflowOptions>) => void;
  onRemove: () => void;
  /** MODULE 27 — forwarded to the message editor's placeholder picker. */
  customFields?: PlaceholderField[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState<"template" | "form" | "agent" | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = action.config ?? {};
  const recipients = recipientsFrom(config);
  const manualOnly = isManualOnly(action.type);

  function patch(next: Record<string, unknown>) {
    onChange({ ...action, config: { ...config, ...next } });
  }

  function setRecipients(next: Recipient[]) {
    patch({ recipients: next });
  }

  async function createSimple(kind: "form" | "agent") {
    const name = newName.trim();
    if (name.length === 0) {
      setError(kind === "form" ? "Give the form a name." : "Give the agent a name.");
      return;
    }

    setBusy(true);
    setError(null);

    const endpoint = kind === "form" ? "/api/forms" : "/api/settings/voice-agents";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { data?: { id?: string; name?: string; purpose?: string; status?: string }; error?: string }
      | null;

    setBusy(false);

    if (!response.ok || !payload?.data?.id) {
      setError(payload?.error ?? "That couldn't be created.");
      return;
    }

    const created = payload.data;

    if (kind === "form") {
      const option: FormOption = {
        id: created.id as string,
        name: created.name ?? name,
        status: created.status ?? "draft",
      };
      onOptionsChanged({ forms: [option, ...options.forms] });
      patch({ form_id: option.id });
    } else {
      const option: AgentOption = {
        id: created.id as string,
        name: created.name ?? name,
        purpose: created.purpose ?? "screening",
        isDefault: false,
      };
      onOptionsChanged({ agents: [option, ...options.agents] });
      patch({ agent_id: option.id });
    }

    setCreating(null);
    setNewName("");
    // The server component's copy catches up in the background; the selection
    // above already happened, so nothing waits for this.
    router.refresh();
  }

  return (
    <div
      className="card mb-2"
      style={{ padding: 16, borderLeft: "3px solid var(--color-border)" }}
    >
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-3">
        <div className="select is-small">
          <select
            value={action.type}
            onChange={(event) => {
              const type = event.target.value as ActionType;
              // The config is DISCARDED on a type change rather than merged. A
              // template_id left over on an "Add a note" action would be stored,
              // invisible, and would reappear if somebody switched back — a
              // stale id pointing at whatever that template has become.
              onChange({
                type,
                config: {
                  manual: isManualOnly(type),
                  ...(RECIPIENT_ACTIONS.includes(type) ? { recipients: [{ kind: "candidate" }] } : {}),
                },
              });
            }}
          >
            {offeredFor(stage, nested).map((type) => (
              <option key={type} value={type}>
                {ACTION_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <button type="button" className="button is-small is-ghost" onClick={onRemove} aria-label="Remove action">
          <X size={14} />
        </button>
      </div>

      {/* --- Action-specific configuration ---------------------------------- */}

      {(action.type === "send_templated_message" || action.type === "request_form") && (
        <TemplatePicker
          templates={options.templates}
          failed={options.failed.includes("templates")}
          value={typeof config.template_id === "string" ? config.template_id : ""}
          label={action.type === "request_form" ? "Message carrying the form link" : "Message template"}
          onSelect={(template) =>
            patch({
              template_id: template?.id ?? "",
              // Copied for the activation check's benefit; the API overwrites
              // both from the template row, which is the authoritative copy.
              event_key: template?.eventKey,
              channels: template ? (template.channel === "both" ? ["email", "whatsapp"] : [template.channel]) : [],
            })
          }
          onCreateNew={() => setCreating("template")}
        />
      )}

      {action.type === "request_form" && (
        <SimplePicker
          label="Form"
          failed={options.failed.includes("forms")}
          failureNote="Forms couldn't be loaded, so this list may be incomplete."
          value={typeof config.form_id === "string" ? config.form_id : ""}
          onChange={(value) => patch({ form_id: value })}
          items={options.forms.map((form) => ({
            value: form.id,
            label: form.status === "published" ? form.name : `${form.name} (${form.status})`,
          }))}
          emptyNote="No forms yet."
          onCreateNew={() => setCreating("form")}
          createLabel="New form"
        />
      )}

      {/*
        MODULE 26, PRIMITIVE #2 — "Show an answer from this form on the
        application."

        Two plain text inputs rather than a dropdown of the form's questions,
        because the questions live on another row that this component does not
        load, and fetching a form's fields on every render of every action card
        would be a request per card. The key is validated against the same
        pattern form_fields enforces, so a typo is refused on save rather than
        surfacing as a permanently blank field.
      */}
      {action.type === "request_form" && (
        <div className="mb-3" style={{ borderLeft: "2px solid var(--color-border)", paddingLeft: 12 }}>
          <p className="label is-small mb-1">Show an answer on the application</p>
          <p className="has-text-secondary mb-2" style={{ fontSize: 12 }}>
            Optional. The candidate&rsquo;s answer appears on the application, read straight from
            their response — nothing is copied, so an edited answer updates itself.
          </p>
          <div className="is-flex" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              className="input is-small"
              style={{ maxWidth: 220 }}
              placeholder="Question key, e.g. preferred_call_time"
              value={typeof config.surface_field_key === "string" ? config.surface_field_key : ""}
              onChange={(event) => patch({ surface_field_key: event.target.value.trim() })}
            />
            <input
              className="input is-small"
              style={{ maxWidth: 220 }}
              placeholder="Label, e.g. Preferred Call Time"
              value={typeof config.surface_label === "string" ? config.surface_label : ""}
              onChange={(event) => patch({ surface_label: event.target.value })}
            />
          </div>
        </div>
      )}

      {/*
        MODULE 26, PRIMITIVE #1 — "Wait, then…".

        The nested action list is edited by RECURSING into this same component.
        A separate nested editor would be a second copy of every picker on this
        screen, and the day somebody added a recipient kind to one of them the
        other would silently not have it.
      */}
      {action.type === "wait_then" && (
        <WaitEditor
          config={config}
          stage={stage}
          options={options}
          onPatch={patch}
          onOptionsChanged={onOptionsChanged}
        />
      )}

      {action.type === "start_screening_call" && (
        <SimplePicker
          label="Voice agent"
          failed={options.failed.includes("agents")}
          failureNote="Voice agents couldn't be loaded, so this list may be incomplete."
          value={typeof config.agent_id === "string" ? config.agent_id : ""}
          onChange={(value) => patch({ agent_id: value || null })}
          items={options.agents.map((agent) => ({
            value: agent.id,
            label: agent.isDefault ? `${agent.name} (default)` : agent.name,
          }))}
          // An empty selection is MEANINGFUL here, unlike on the form picker:
          // it means "whatever this organization's default agent is", which is
          // how every screening call worked before this builder existed.
          placeholder="Organization default"
          emptyNote="No agents configured — the organization default will dial."
          onCreateNew={() => setCreating("agent")}
          createLabel="New agent"
        />
      )}

      {action.type === "ai_resume_shortlist" && (
        <div className="mb-3">
          <label className="label is-small" htmlFor={`passing-${action.type}`}>
            Passing mark
          </label>
          <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
            <input
              id={`passing-${action.type}`}
              className="input is-small"
              style={{ maxWidth: 110 }}
              type="number"
              min={0}
              max={100}
              placeholder="Job default"
              value={typeof config.passing_score === "number" ? config.passing_score : ""}
              onChange={(event) =>
                patch({
                  passing_score: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
            <span className="has-text-secondary" style={{ fontSize: 12 }}>
              Leave empty to use this job&rsquo;s Resume Score passing mark.
            </span>
          </div>
          <label className="checkbox is-block mt-2" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={config.advance_on_pass !== false}
              onChange={(event) => patch({ advance_on_pass: event.target.checked })}
            />{" "}
            Move to Shortlisted on a pass
          </label>
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            A resume below the mark is flagged <strong>Not Shortlisted</strong> — it stays on the
            board in Applied, and any recruiter can reverse it. It is never rejected automatically.
          </p>
        </div>
      )}

      {action.type === "move_to_stage" && (
        <SimplePicker
          label="Move to"
          failed={false}
          value={typeof config.stage === "string" ? config.stage : ""}
          onChange={(value) => patch({ stage: value })}
          items={STAGE_CHOICES}
          emptyNote=""
        />
      )}

      {action.type === "add_note" && (
        <div className="mb-3">
          <label className="label is-small" htmlFor="note-text">
            Note
          </label>
          <textarea
            id="note-text"
            className="textarea is-small"
            rows={2}
            value={typeof config.text === "string" ? config.text : ""}
            onChange={(event) => patch({ text: event.target.value })}
          />
        </div>
      )}

      {/* --- Recipients ----------------------------------------------------- */}

      {RECIPIENT_ACTIONS.includes(action.type) && (
        <RecipientPicker
          recipients={recipients}
          members={options.members}
          membersFailed={options.failed.includes("members")}
          onChange={setRecipients}
        />
      )}

      {/* --- Automatic vs manual -------------------------------------------- */}

      <div className="mt-3" style={{ display: nested ? "none" : undefined }}>
        <label className="checkbox" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={config.manual === true}
            disabled={manualOnly || nested}
            onChange={(event) => patch({ manual: event.target.checked })}
          />{" "}
          Manual trigger — show a button on the application instead of firing automatically
        </label>
        {manualOnly && (
          <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
            Scheduling needs somebody to choose a time, so this action is always manual.
          </p>
        )}
      </div>

      {error && <FormError message={error} />}

      {/* --- Inline creation ------------------------------------------------ */}

      {creating === "template" && (
        <div className="mt-4" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
          <p className="label is-small">New message template</p>
          {/*
            THE SETTINGS PAGE'S OWN EDITOR, rendered here. Not a copy — the
            import at the top of this file is app/settings/templates/
            TemplateEditor.tsx, and it saves through the same API route.
          */}
          <TemplateEditor
            template={null}
            customFields={customFields}
            eventKey={
              typeof config.event_key === "string"
                ? (config.event_key as TemplateOption["eventKey"])
                : "shortlisted"
            }
            emailConnected
            whatsappConnected
            onDone={() => {
              setCreating(null);
              // The editor owns the POST, so the new row's id is not returned to
              // this component. A refresh is the honest way to pick it up, and
              // the template list is small enough that it is immediate.
              router.refresh();
            }}
            onCancel={() => setCreating(null)}
          />
        </div>
      )}

      {(creating === "form" || creating === "agent") && (
        <div className="mt-4" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
          <label className="label is-small" htmlFor="new-item-name">
            {creating === "form" ? "New form name" : "New agent name"}
          </label>
          <div className="is-flex" style={{ gap: "0.5rem" }}>
            <input
              id="new-item-name"
              className="input is-small"
              value={newName}
              autoFocus
              onChange={(event) => setNewName(event.target.value)}
            />
            <button
              type="button"
              className={`button is-small is-primary ${busy ? "is-loading" : ""}`}
              onClick={() => createSimple(creating)}
              disabled={busy}
            >
              Create
            </button>
            <button
              type="button"
              className="button is-small"
              onClick={() => {
                setCreating(null);
                setNewName("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            {creating === "form" ? (
              <>
                Creates a draft form and selects it here. Add its questions and publish it on the{" "}
                <Link href="/forms">Forms</Link> page — an unpublished form is skipped rather than
                sent.
              </>
            ) : (
              <>
                Creates an agent with the default persona and selects it here. Give it its script
                and voice in the <Link href="/settings/voice-agents">Voice Agent Console</Link>.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The stages `move_to_stage` may target.
 *
 * Derived from APPLICATION_STAGES rather than typed out, so a change to the
 * pipeline definition reaches this picker without anybody remembering to come
 * here. That is the whole reason the eight-stage list lives in one file.
 */
const STAGE_CHOICES: { value: string; label: string }[] = APPLICATION_STAGES.map((stage) => ({
  value: stage,
  label: STAGE_LABELS[stage],
}));

function TemplatePicker({
  templates,
  failed,
  value,
  label,
  onSelect,
  onCreateNew,
}: {
  templates: TemplateOption[];
  failed: boolean;
  value: string;
  label: string;
  onSelect: (template: TemplateOption | null) => void;
  onCreateNew: () => void;
}) {
  return (
    <div className="mb-3">
      <label className="label is-small" htmlFor="template-select">
        {label}
      </label>
      <div className="is-flex is-align-items-center" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <div className="select is-small">
          <select
            id="template-select"
            value={value}
            onChange={(event) =>
              onSelect(templates.find((template) => template.id === event.target.value) ?? null)
            }
          >
            <option value="">Choose a template…</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.active ? template.name : `${template.name} (off)`}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="button is-small" onClick={onCreateNew}>
          <Plus size={13} /> <span className="ml-1">New template</span>
        </button>
      </div>
      {failed && (
        <p className="has-text-secondary mt-1" style={{ fontSize: 12, color: "var(--color-warning)" }}>
          Message templates couldn&rsquo;t be loaded, so this list may be incomplete.
        </p>
      )}
    </div>
  );
}

function SimplePicker({
  label,
  value,
  items,
  onChange,
  emptyNote,
  placeholder = "Choose…",
  onCreateNew,
  createLabel,
  failed,
  failureNote,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
  emptyNote: string;
  placeholder?: string;
  onCreateNew?: () => void;
  createLabel?: string;
  failed: boolean;
  failureNote?: string;
}) {
  return (
    <div className="mb-3">
      <label className="label is-small" htmlFor={`picker-${label}`}>
        {label}
      </label>
      <div className="is-flex is-align-items-center" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <div className="select is-small">
          <select id={`picker-${label}`} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{placeholder}</option>
            {items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        {onCreateNew && (
          <button type="button" className="button is-small" onClick={onCreateNew}>
            <Plus size={13} /> <span className="ml-1">{createLabel}</span>
          </button>
        )}
      </div>
      {items.length === 0 && emptyNote && (
        <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
          {emptyNote}
        </p>
      )}
      {failed && failureNote && (
        <p className="mt-1" style={{ fontSize: 12, color: "var(--color-warning)" }}>
          {failureNote}
        </p>
      )}
    </div>
  );
}

/**
 * The recipient list.
 *
 * Renders every kind as a checkbox rather than a multi-select, because the
 * options are four and the question ("who should hear about this?") is one
 * people answer by ticking, not by cmd-clicking. Named members are added
 * separately below, since there can be many.
 */
function RecipientPicker({
  recipients,
  members,
  membersFailed,
  onChange,
}: {
  recipients: Recipient[];
  members: MemberOption[];
  membersFailed: boolean;
  onChange: (next: Recipient[]) => void;
}) {
  const kinds = new Set(recipients.map((recipient) => recipient.kind));
  const namedIds = recipients
    .filter((recipient) => recipient.kind === "organization_member")
    .map((recipient) => recipient.userId as string);

  function toggleKind(kind: RecipientKind, on: boolean) {
    if (kind === "organization_member") return;
    onChange(
      on
        ? [...recipients, { kind }]
        : recipients.filter((recipient) => recipient.kind !== kind)
    );
  }

  return (
    <div className="mb-3">
      <p className="label is-small">Send to</p>

      {RECIPIENT_KINDS.filter((kind) => kind !== "organization_member").map((kind) => (
        <label key={kind} className="checkbox is-block" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={kinds.has(kind)}
            onChange={(event) => toggleKind(kind, event.target.checked)}
          />{" "}
          {RECIPIENT_LABELS[kind]}{" "}
          <span className="has-text-secondary">— {RECIPIENT_HINTS[kind]}</span>
        </label>
      ))}

      <div className="mt-2">
        <label className="label is-small" htmlFor="member-add">
          {RECIPIENT_LABELS.organization_member}
        </label>
        <div className="select is-small">
          <select
            id="member-add"
            value=""
            disabled={recipients.length >= MAX_RECIPIENTS}
            onChange={(event) => {
              if (!event.target.value) return;
              onChange([
                ...recipients,
                { kind: "organization_member", userId: event.target.value },
              ]);
            }}
          >
            <option value="">Add a colleague…</option>
            {members
              .filter((member) => !namedIds.includes(member.userId))
              .map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
          </select>
        </div>

        {namedIds.length > 0 && (
          <div className="is-flex mt-2" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
            {namedIds.map((userId) => (
              <span key={userId} className="tag is-light" style={{ fontSize: 12 }}>
                {members.find((member) => member.userId === userId)?.name ?? "A team member"}
                <button
                  type="button"
                  className="button is-ghost is-small ml-1"
                  style={{ height: "auto", padding: 0 }}
                  aria-label="Remove recipient"
                  onClick={() =>
                    onChange(
                      recipients.filter(
                        (recipient) =>
                          !(recipient.kind === "organization_member" && recipient.userId === userId)
                      )
                    )
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {membersFailed && (
        <p className="mt-1" style={{ fontSize: 12, color: "var(--color-warning)" }}>
          The team list couldn&rsquo;t be loaded, so some colleagues may be missing here.
        </p>
      )}

      <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
        Colleagues get the same message with the candidate&rsquo;s details filled in — and no
        unsubscribe footer, since the candidate&rsquo;s opt-out doesn&rsquo;t govern internal mail.
      </p>
    </div>
  );
}

/**
 * The "Wait, then…" editor.
 *
 * RECURSES into WorkflowActionEditor for the nested list — see the call site for
 * why that beats a second nested editor.
 *
 * The recursion terminates because the catalogue refuses to nest a wait inside a
 * wait, and the action-type picker below filters `wait_then` out of the nested
 * options. Two guards for one rule, deliberately: the picker keeps somebody from
 * trying, and the validator keeps a hand-written rule from succeeding.
 */
function WaitEditor({
  config,
  stage,
  options,
  onPatch,
  onOptionsChanged,
}: {
  config: Record<string, unknown>;
  stage: ApplicationStage;
  options: WorkflowOptions;
  onPatch: (next: Record<string, unknown>) => void;
  onOptionsChanged: (patch: Partial<WorkflowOptions>) => void;
}) {
  const nested = Array.isArray(config.actions) ? (config.actions as Action[]) : [];
  const minutes = typeof config.delay_minutes === "number" ? config.delay_minutes : 30;
  const basis = isDelayBasis(config.delay_basis) ? config.delay_basis : "after";

  /**
   * Hours are a DISPLAY unit only — everything is stored in minutes.
   *
   * Two units in the database would mean every reader has to normalise, and the
   * first one that forgot would produce a wait sixty times too long.
   */
  const showHours = minutes >= 60 && minutes % 60 === 0;
  const displayValue = showHours ? minutes / 60 : minutes;

  function setNested(next: Action[]) {
    onPatch({ actions: next });
  }

  return (
    <div className="mb-3">
      <label className="label is-small" htmlFor="wait-amount">
        Wait
      </label>
      <div className="is-flex is-align-items-center mb-2" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          id="wait-amount"
          className="input is-small"
          style={{ maxWidth: 90 }}
          type="number"
          min={1}
          value={displayValue}
          onChange={(event) => {
            const raw = Number(event.target.value);
            if (!Number.isFinite(raw)) return;
            onPatch({ delay_minutes: showHours ? Math.round(raw * 60) : Math.round(raw) });
          }}
        />
        <div className="select is-small">
          <select
            aria-label="Unit"
            value={showHours ? "hours" : "minutes"}
            onChange={(event) => {
              // Converts rather than reinterpreting: switching the unit must not
              // silently turn a 30-minute wait into a 30-hour one.
              onPatch({
                delay_minutes:
                  event.target.value === "hours"
                    ? Math.max(Math.round(displayValue) * 60, 60)
                    : Math.max(Math.round(displayValue), 1),
              });
            }}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </select>
        </div>
        <div className="select is-small">
          <select
            aria-label="Measured from"
            value={basis}
            onChange={(event) => onPatch({ delay_basis: event.target.value })}
          >
            {DELAY_BASES.map((option) => (
              <option key={option} value={option}>
                {DELAY_BASIS_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
        {basis === "after" ? (
          <>
            Fires {describeDelay(minutes)} after this stage&rsquo;s other actions. Cancelled
            automatically if the application moves to another stage first.
          </>
        ) : (
          <>
            Fires {describeDelay(minutes)} before the scheduled time — not at a fixed hour. If
            nothing is booked yet, nothing is queued and the run log says so.
          </>
        )}
      </p>

      <p className="label is-small mb-1">Then</p>

      {nested.length === 0 ? (
        <p className="has-text-secondary mb-2" style={{ fontSize: 12 }}>
          Nothing yet — a wait with no actions after it does nothing.
        </p>
      ) : (
        nested.map((nestedAction, index) => (
          <WorkflowActionEditor
            key={index}
            action={nestedAction}
            stage={stage}
            options={options}
            nested
            onChange={(next) => {
              const list = [...nested];
              list[index] = next;
              setNested(list);
            }}
            onOptionsChanged={onOptionsChanged}
            onRemove={() => setNested(nested.filter((_, position) => position !== index))}
          />
        ))
      )}

      <button
        type="button"
        className="button is-small"
        onClick={() =>
          setNested([
            ...nested,
            {
              type: "send_templated_message",
              config: { recipients: [{ kind: "candidate" }], manual: false },
            },
          ])
        }
      >
        <Plus size={13} /> <span className="ml-1">Add action after the wait</span>
      </button>
    </div>
  );
}
