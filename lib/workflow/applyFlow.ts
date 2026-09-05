// =============================================================================
// Applying the Default Recruitment Flow to a job. SERVER ONLY.
//
// -----------------------------------------------------------------------------
// IDEMPOTENT BY NAME, ACROSS ALL THREE KINDS OF ROW.
//
// A recruiter will apply this to a second job, and a third. The templates and
// forms are ORGANIZATION-level, so the second application must find the ones the
// first created rather than making "CV Shortlisted (2)". Matching is by name
// within the organization, which is also what a person would do.
//
// The consequence worth stating: a recruiter who has already rewritten "CV
// Shortlisted" keeps their wording when they apply the flow to another job. This
// function never overwrites existing copy — it creates what is missing and
// leaves the rest alone. Overwriting would silently discard somebody's edits at
// the exact moment they were extending the thing they had customised.
//
// The AUTOMATIONS are per job and are replaced, because those are what "apply
// the flow to this job" means.
//
// -----------------------------------------------------------------------------
// EVERYTHING LANDS AS A DRAFT, AND THE TEMPLATES LAND INACTIVE.
//
// Two separate switches, both off:
//
//   - message_templates.active = false (the column default; not overridden).
//   - the automations rows are saved with activate: false.
//
// So applying the flow changes nothing about what candidates receive until a
// person reads the wording and turns it on. Given that this writes seven
// messages that will go out over the organisation's name, any other default
// would be the product making a decision that is not its to make.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { formatDbError } from "@/lib/supabase/errors";
import { saveStageWorkflow } from "@/lib/workflow/queries";
import {
  DEFAULT_FLOW_LABEL,
  FLOW_FORMS,
  FLOW_TEMPLATES,
  defaultFlowLists,
  type FlowAction,
} from "@/lib/workflow/defaultFlow";
import { channelsFor } from "@/lib/communications/templates";
import type { Action } from "@/lib/automations/catalog";

export type ApplyFlowResult =
  | {
      ok: true;
      templatesCreated: string[];
      templatesReused: string[];
      formsCreated: string[];
      formsReused: string[];
      listsSaved: number;
      /**
       * Things a person has to do before any of this reaches a candidate.
       *
       * RETURNED, not logged. The UI shows them on the confirmation, because an
       * "Applied!" message with no next step reads as "it is running now" — and
       * it is not, by design.
       */
      todo: string[];
    }
  | { ok: false; error: string; status: number };

export async function applyDefaultFlow({
  organizationId,
  jobId,
  jobTitle,
  userId,
}: {
  organizationId: string;
  jobId: string;
  jobTitle: string;
  userId: string;
}): Promise<ApplyFlowResult> {
  const supabase = await createClient();

  // ---------------------------------------------------------------------------
  // 1. The message templates.
  // ---------------------------------------------------------------------------
  const { data: existingTemplateRows, error: templateReadError } = await supabase
    .from("message_templates")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in(
      "name",
      FLOW_TEMPLATES.map((template) => template.name)
    );

  if (templateReadError) {
    return { ok: false, error: formatDbError(templateReadError), status: 500 };
  }

  const templateIdByName = new Map(
    ((existingTemplateRows ?? []) as { id: string; name: string }[]).map((row) => [row.name, row.id])
  );

  const templatesCreated: string[] = [];
  const templatesReused: string[] = [];
  /** flow key -> real template id. */
  const templateIdByKey = new Map<string, string>();

  for (const template of FLOW_TEMPLATES) {
    const existing = templateIdByName.get(template.name);

    if (existing) {
      templateIdByKey.set(template.key, existing);
      templatesReused.push(template.name);
      continue;
    }

    const { data, error } = await supabase
      .from("message_templates")
      .insert({
        organization_id: organizationId,
        name: template.name,
        event_key: template.eventKey,
        channel: template.channel,
        subject: template.subject,
        body: template.body,
        whatsapp_body: template.whatsappBody,
        // `active` is deliberately NOT set. The column defaults to false and
        // that default is the rule — see the header.
        created_by: userId,
      })
      .select("id")
      .single();

    if (error) {
      return {
        ok: false,
        error: `Could not create the "${template.name}" template: ${formatDbError(error)}`,
        status: 500,
      };
    }

    templateIdByKey.set(template.key, (data as { id: string }).id);
    templatesCreated.push(template.name);
  }

  // ---------------------------------------------------------------------------
  // 2. The forms.
  // ---------------------------------------------------------------------------
  const { data: existingFormRows, error: formReadError } = await supabase
    .from("forms")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in(
      "name",
      FLOW_FORMS.map((form) => form.name)
    );

  if (formReadError) {
    return { ok: false, error: formatDbError(formReadError), status: 500 };
  }

  const formIdByName = new Map(
    ((existingFormRows ?? []) as { id: string; name: string }[]).map((row) => [row.name, row.id])
  );

  const formsCreated: string[] = [];
  const formsReused: string[] = [];
  const formIdByKey = new Map<string, string>();

  for (const form of FLOW_FORMS) {
    const existing = formIdByName.get(form.name);

    if (existing) {
      formIdByKey.set(form.key, existing);
      formsReused.push(form.name);
      continue;
    }

    const { data, error } = await supabase
      .from("forms")
      .insert({
        organization_id: organizationId,
        name: form.name,
        description: form.description,
        /**
         * `pre_interview`, NOT `job_application`.
         *
         * The purpose enum decides behaviour, not labelling: a job_application
         * form creates a CANDIDATE and an APPLICATION on submit, and must carry
         * a job_id. These forms are answered by somebody who already has both.
         * Marking them job_application would create a duplicate candidate every
         * time one was submitted.
         */
        purpose: "pre_interview",
        // Draft, like everything else here. Publishing is the deliberate act
        // that makes the link work, and request_form skips an unpublished form
        // rather than sending a link to a page that refuses the candidate.
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();

    if (error) {
      return {
        ok: false,
        error: `Could not create the "${form.name}" form: ${formatDbError(error)}`,
        status: 500,
      };
    }

    const formId = (data as { id: string }).id;

    const { error: fieldError } = await supabase.from("form_fields").insert({
      organization_id: organizationId,
      form_id: formId,
      field_key: form.fieldKey,
      label: form.fieldLabel,
      help_text: form.helpText,
      // radio, not date: see the header of defaultFlow.ts. A `date` field would
      // collect the day and lose the time, which is the part a call needs.
      field_type: "radio",
      options: form.options,
      required: true,
      is_standard: false,
      display_order: 0,
    });

    if (fieldError) {
      return {
        ok: false,
        error: `Could not add the question to "${form.name}": ${formatDbError(fieldError)}`,
        status: 500,
      };
    }

    formIdByKey.set(form.key, formId);
    formsCreated.push(form.name);
  }

  // ---------------------------------------------------------------------------
  // 3. The stage workflows.
  // ---------------------------------------------------------------------------
  let listsSaved = 0;

  for (const list of defaultFlowLists()) {
    const resolved = list.actions.map((action) =>
      resolveAction(action, templateIdByKey, formIdByKey, FLOW_TEMPLATES)
    );

    const saved = await saveStageWorkflow({
      organizationId,
      jobId,
      jobTitle,
      stage: list.stage,
      branch: list.branch,
      actions: resolved,
      // Draft. See the header — the flow does nothing until somebody reviews it.
      activate: false,
      userId,
    });

    if (!saved.ok) {
      return {
        ok: false,
        // Names the stage. "Could not save the workflow" would leave a recruiter
        // with a partly applied flow and no idea which part is missing.
        error: `Could not save the ${list.stage} (${list.branch}) actions: ${saved.error}`,
        status: saved.status,
      };
    }

    listsSaved += 1;
  }

  return {
    ok: true,
    templatesCreated,
    templatesReused,
    formsCreated,
    formsReused,
    listsSaved,
    todo: buildTodo({ templatesCreated, formsCreated }),
  };
}

/**
 * Swaps a flow action's `ref` keys for the real ids, and flattens `nested` into
 * the `wait_then` config shape the catalogue validates.
 *
 * The two-shape split exists so defaultFlow.ts can be a readable constant:
 * writing `config: { actions: [...] }` inline three levels deep is how a
 * definition becomes unreadable, and this is the one place that has to know
 * about it.
 */
function resolveAction(
  action: FlowAction,
  templateIds: Map<string, string>,
  formIds: Map<string, string>,
  templates: typeof FLOW_TEMPLATES
): Action {
  const config: Record<string, unknown> = { ...action.config };

  if (action.ref?.templateKey) {
    const id = templateIds.get(action.ref.templateKey);
    if (id) {
      config.template_id = id;
      const definition = templates.find((entry) => entry.key === action.ref?.templateKey);
      if (definition) {
        config.event_key = definition.eventKey;
        // Copied so the activation check can see which integrations the rule
        // needs. The API re-reads both from the template row, which is the
        // authoritative copy — this is a hint, not the source of truth.
        config.channels = channelsFor(definition.channel);
      }
    }
  }

  if (action.ref?.formKey) {
    const id = formIds.get(action.ref.formKey);
    if (id) config.form_id = id;
  }

  if (action.nested) {
    config.actions = action.nested.map((nested) =>
      resolveAction(nested, templateIds, formIds, templates)
    );
  }

  return { type: action.type, config };
}

/**
 * What the recruiter still has to do.
 *
 * Every item is something the product deliberately did not decide for them, and
 * each says WHY in the same breath — a checklist of chores reads as friction,
 * the same checklist with reasons reads as care.
 */
function buildTodo({
  templatesCreated,
  formsCreated,
}: {
  templatesCreated: string[];
  formsCreated: string[];
}): string[] {
  const todo: string[] = [];

  if (templatesCreated.length > 0) {
    todo.push(
      `Read and switch on ${templatesCreated.length} message template${
        templatesCreated.length === 1 ? "" : "s"
      } in Settings → Templates. They ship off, because they'll go out over your name.`
    );
  }

  if (formsCreated.length > 0) {
    todo.push(
      `Publish ${formsCreated.length} form${
        formsCreated.length === 1 ? "" : "s"
      } on the Forms page — edit the time slots first if the defaults don't suit you. An unpublished form is skipped rather than sent.`
    );
  }

  todo.push(
    "Set this job's Resume Score passing mark on the job page. Without one the " +
      "resume screen reaches no decision and nobody is shortlisted or flagged."
  );

  todo.push(
    "Add your office address in Settings → Organization, for the Director Round invitation."
  );

  todo.push(
    `Activate each stage's actions from the Stage Workflow section. Everything ` +
      `${DEFAULT_FLOW_LABEL} created is saved as a draft.`
  );

  return todo;
}
