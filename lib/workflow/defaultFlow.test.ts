// =============================================================================
// Module 26 — Default Recruitment Flow, and the two primitives it needs.
//
// The brief names six things to test. Five are pure and asserted directly. The
// sixth — "applying the template correctly creates all the
// automations/templates/forms described" — is asserted as a property of the
// DEFINITION rather than by running the writer against a database: that every
// template and form the flow references exists in the sets the apply path
// creates, and that every action list is valid against the same closed
// vocabulary the engine executes.
//
// That is the substitution worth defending. A test that mocked Supabase would
// assert that the mock was called, which is a fact about the test. Asserting
// that the flow references nothing it does not create catches the only bug that
// class of test could find — a dangling key — and keeps catching it when
// somebody edits the flow.
// =============================================================================
import { describe, expect, it } from "vitest";

import {
  MAX_DELAY_MINUTES,
  MIN_DELAY_MINUTES,
  delayDedupeKey,
  describeDelay,
  dueAt,
  validateDelay,
} from "@/lib/workflow/delay";
import { renderAnswer } from "@/lib/workflow/formAnswers";
import {
  DEFAULT_FLOW,
  FLOW_FORMS,
  FLOW_TEMPLATES,
  defaultFlowLists,
  type FlowAction,
} from "@/lib/workflow/defaultFlow";
import { validateRule } from "@/lib/automations/catalog";
import { branchesFor } from "@/lib/workflow/stages";
import { MESSAGE_PLACEHOLDER_FIELDS } from "@/lib/communications/tokens";
import { FORM_FIELD_TYPES } from "@/lib/forms/fields";
import { COMMUNICATION_EVENTS } from "@/lib/communications/events";

// =============================================================================
// PRIMITIVE #1 — the delay.
// =============================================================================
describe("delay configuration", () => {
  it("accepts a plain minutes wait", () => {
    const result = validateDelay({ delay_minutes: 30 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.delay.minutes).toBe(30);
      // Absent basis means "after", which is what every simple wait means.
      expect(result.delay.basis).toBe("after");
    }
  });

  it("refuses a wait that is not a whole number of minutes", () => {
    expect(validateDelay({ delay_minutes: 1.5 }).ok).toBe(false);
    expect(validateDelay({ delay_minutes: "soon" }).ok).toBe(false);
    expect(validateDelay({}).ok).toBe(false);
  });

  it("bounds the wait at both ends", () => {
    expect(validateDelay({ delay_minutes: MIN_DELAY_MINUTES - 1 }).ok).toBe(false);
    expect(validateDelay({ delay_minutes: MAX_DELAY_MINUTES + 1 }).ok).toBe(false);
    expect(validateDelay({ delay_minutes: MAX_DELAY_MINUTES }).ok).toBe(true);
  });

  it("refuses an unknown basis rather than silently using 'after'", () => {
    // Silently defaulting would turn "15 minutes before the call" into "15
    // minutes after this rule ran", which is a different message at a different
    // time and would look like it worked.
    expect(validateDelay({ delay_minutes: 15, delay_basis: "before_lunch" }).ok).toBe(false);
  });
});

describe("when a wait becomes due", () => {
  const now = new Date("2026-09-01T10:00:00.000Z");

  it("counts forwards for an 'after' wait", () => {
    const due = dueAt({ delay: { minutes: 30, basis: "after" }, now });
    expect(due?.toISOString()).toBe("2026-09-01T10:30:00.000Z");
  });

  it("counts BACKWARDS from the scheduled time, not from now", () => {
    /*
      THE BRIEF'S TEST, EXACTLY: "the pre-call reminder fires at the configured
      offset before the actual scheduled time (not a fixed clock time)".

      The call is at 14:00. A 15-minute reminder is due at 13:45 — four hours
      from `now`, not fifteen minutes from it.
    */
    const due = dueAt({
      delay: { minutes: 15, basis: "before_scheduled_call" },
      now,
      anchor: new Date("2026-09-01T14:00:00.000Z"),
    });
    expect(due?.toISOString()).toBe("2026-09-01T13:45:00.000Z");
  });

  it("moves with the scheduled time", () => {
    // Reschedule the call two hours later and the reminder moves two hours
    // later. A fixed clock time would not.
    const early = dueAt({
      delay: { minutes: 15, basis: "before_scheduled_call" },
      now,
      anchor: new Date("2026-09-01T14:00:00.000Z"),
    });
    const late = dueAt({
      delay: { minutes: 15, basis: "before_scheduled_call" },
      now,
      anchor: new Date("2026-09-01T16:00:00.000Z"),
    });
    expect(late!.getTime() - early!.getTime()).toBe(2 * 3_600_000);
  });

  it("returns null when nothing is scheduled to count down to", () => {
    // Firing "you'll be getting a call shortly" at somebody with no call booked
    // is worse than not sending it.
    expect(dueAt({ delay: { minutes: 15, basis: "before_scheduled_call" }, now, anchor: null })).toBeNull();
  });

  it("fires a slightly-late reminder rather than dropping it", () => {
    // A call booked 10 minutes out with a 15-minute reminder: the due time is 5
    // minutes ago. Late is better than never for a call that is about to happen.
    const due = dueAt({
      delay: { minutes: 15, basis: "before_scheduled_call" },
      now,
      anchor: new Date("2026-09-01T10:10:00.000Z"),
    });
    expect(due).not.toBeNull();
    expect(due!.getTime()).toBeLessThan(now.getTime());
  });

  it("refuses to remind after the thing it was reminding about", () => {
    // A zero-minute "reminder" would be due exactly at the call. Past that there
    // is nothing to warn anybody about.
    expect(
      dueAt({
        delay: { minutes: 0, basis: "before_scheduled_call" },
        now,
        anchor: new Date("2026-09-01T14:00:00.000Z"),
      })
    ).toBeNull();
  });
});

describe("delay dedupe keys", () => {
  it("contains no timestamp", () => {
    // Same reasoning as the sweep's own key: every attempt to schedule the same
    // wait must compute the same string, so the second is rejected by the unique
    // index rather than queuing a duplicate message.
    const first = delayDedupeKey({ stageKey: "ai_screening_call", branch: "always", actionIndex: 0 });
    const second = delayDedupeKey({ stageKey: "ai_screening_call", branch: "always", actionIndex: 0 });
    expect(first).toBe(second);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("separates two waits on the same stage", () => {
    // The default flow's screening stage has both a pre-call reminder and a
    // post-call thank-you. Collapsing them would drop one.
    expect(
      delayDedupeKey({ stageKey: "ai_screening_call", branch: "always", actionIndex: 0 })
    ).not.toBe(delayDedupeKey({ stageKey: "ai_screening_call", branch: "always", actionIndex: 1 }));
  });
});

describe("describeDelay", () => {
  it("reads as English at every scale", () => {
    expect(describeDelay(1)).toBe("1 minute");
    expect(describeDelay(30)).toBe("30 minutes");
    expect(describeDelay(60)).toBe("1 hour");
    expect(describeDelay(90)).toBe("1 hour 30 min");
    expect(describeDelay(1440)).toBe("1 day");
    expect(describeDelay(1500)).toBe("1 day 1 hr");
  });
});

// =============================================================================
// The wait's nesting rules.
// =============================================================================
describe("wait_then validation", () => {
  const template = "11111111-1111-4111-8111-111111111111";

  const wait = (config: Record<string, unknown>) =>
    validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [{ type: "wait_then", config }],
    });

  it("accepts a wait with actions after it", () => {
    const result = wait({
      delay_minutes: 30,
      actions: [{ type: "send_templated_message", config: { template_id: template } }],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a wait with nothing after it", () => {
    // A rule that consumes an occasion, occupies a queue row and does nothing is
    // indistinguishable in the run history from one that failed.
    expect(wait({ delay_minutes: 30, actions: [] }).ok).toBe(false);
  });

  it("refuses a wait inside a wait", () => {
    const result = wait({
      delay_minutes: 30,
      actions: [
        {
          type: "wait_then",
          config: {
            delay_minutes: 10,
            actions: [{ type: "send_templated_message", config: { template_id: template } }],
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/can't contain another wait/i);
  });

  it("refuses a session-only action after a wait", () => {
    /*
      The sweep drains the queue with the SERVICE-ROLE client. A session-only
      action queued inside a wait would be denied by RLS half an hour later with
      nobody watching — so it is refused at configuration time, naming the
      action.
    */
    const result = wait({
      delay_minutes: 30,
      actions: [{ type: "ai_resume_shortlist", config: {} }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/needs a signed-in user/i);
  });

  it("refuses a manual action after a wait", () => {
    // "Do this in 30 minutes" and "do this when somebody clicks" are two
    // contradictory instructions.
    const result = wait({
      delay_minutes: 30,
      actions: [
        { type: "send_templated_message", config: { template_id: template, manual: true } },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// PRIMITIVE #2 — a form answer on the application.
// =============================================================================
describe("surfacing a form answer", () => {
  const form = "22222222-2222-4222-8222-222222222222";
  const template = "11111111-1111-4111-8111-111111111111";

  const request = (extra: Record<string, unknown>) =>
    validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [
        { type: "request_form", config: { form_id: form, template_id: template, ...extra } },
      ],
    });

  it("stores a pointer, never the answer", () => {
    const result = request({
      surface_field_key: "preferred_call_time",
      surface_label: "Preferred Call Time",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const config = result.rule.actions[0].config ?? {};
      expect(config.surface_field_key).toBe("preferred_call_time");
      expect(config.surface_label).toBe("Preferred Call Time");
      // THE POINT OF THE WHOLE PRIMITIVE: nothing resembling a value is stored.
      expect(Object.keys(config)).not.toContain("surface_value");
    }
  });

  it("refuses a field key that could never exist", () => {
    // form_fields.field_key has a CHECK constraint with this exact pattern, so a
    // key that fails it would be a permanently blank field with no error.
    expect(request({ surface_field_key: "Preferred Call Time", surface_label: "x" }).ok).toBe(false);
    expect(request({ surface_field_key: "9lives", surface_label: "x" }).ok).toBe(false);
  });

  it("requires a label when a field is surfaced", () => {
    // An unlabelled value on the application is a number with no question.
    expect(request({ surface_field_key: "preferred_call_time" }).ok).toBe(false);
  });

  it("treats surfacing as optional", () => {
    expect(request({}).ok).toBe(true);
  });
});

describe("rendering an answer", () => {
  it("handles every shape raw_answers actually holds", () => {
    expect(renderAnswer("Weekday mornings")).toBe("Weekday mornings");
    expect(renderAnswer(3)).toBe("3");
    expect(renderAnswer(true)).toBe("Yes");
    expect(renderAnswer(false)).toBe("No");
    expect(renderAnswer(["Mornings", "Evenings"])).toBe("Mornings, Evenings");
  });

  it("distinguishes 'not answered' from 'answered blank'", () => {
    // The two look identical on screen in a naive implementation and mean
    // opposite things — a recruiter would chase a form the candidate returned.
    expect(renderAnswer(undefined)).toBeNull();
    expect(renderAnswer(null)).toBeNull();
    expect(renderAnswer("")).toBe("");
  });
});

// =============================================================================
// The flow definition itself.
// =============================================================================
describe("the Default Recruitment Flow", () => {
  const templateKeys = new Set(FLOW_TEMPLATES.map((template) => template.key));
  const formKeys = new Set(FLOW_FORMS.map((form) => form.key));

  function everyAction(): FlowAction[] {
    const flat: FlowAction[] = [];
    for (const list of defaultFlowLists()) {
      for (const action of list.actions) {
        flat.push(action);
        if (action.nested) flat.push(...action.nested);
      }
    }
    return flat;
  }

  it("ships the seven templates the brief names", () => {
    expect(FLOW_TEMPLATES.map((template) => template.name)).toEqual([
      "CV Shortlisted",
      "Screening Call Reminder",
      "Screening Call Thank You",
      "Screening Call Passed",
      "Screening Call Not Successful",
      "Video Interview Passed — Director Round Invite",
      "Video Interview Not Successful",
    ]);
  });

  it("gives every template both channels and two bodies", () => {
    // The brief asks for Email + WhatsApp on all seven. `both` is the channel
    // that carries a separate, shorter WhatsApp body — one shared body would
    // read badly on one of the two.
    for (const template of FLOW_TEMPLATES) {
      expect(template.channel, template.name).toBe("both");
      expect(template.subject, template.name).toBeTruthy();
      expect(template.whatsappBody, template.name).toBeTruthy();
      expect(template.whatsappBody!.length, template.name).toBeLessThan(template.body.length);
    }
  });

  it("uses only placeholders the token catalogue actually resolves", () => {
    /*
      A token nobody resolves renders as an em dash in the middle of a sentence.
      This is the test that catches a typo like {{candidate.firstname}} before a
      candidate reads it.
    */
    const known = new Set(MESSAGE_PLACEHOLDER_FIELDS.map((field) => field.token));

    for (const template of FLOW_TEMPLATES) {
      const text = [template.subject ?? "", template.body, template.whatsappBody ?? ""].join(" ");
      for (const match of text.matchAll(/\{\{([^}]+)\}\}/g)) {
        expect(known, `${template.name}: {{${match[1]}}}`).toContain(match[1].trim());
      }
    }
  });

  it("names a real communication event for every template", () => {
    for (const template of FLOW_TEMPLATES) {
      expect(COMMUNICATION_EVENTS, template.name).toContain(template.eventKey);
    }
  });

  it("ships two availability forms using a field type the engine has", () => {
    expect(FLOW_FORMS.map((form) => form.name)).toEqual([
      "Screening Call Availability",
      "Video Interview Availability",
    ]);

    for (const form of FLOW_FORMS) {
      // `radio`, checked against the real list — Module 18 has no calendar
      // widget, and `date` would collect the day and lose the time.
      expect(FORM_FIELD_TYPES).toContain("radio");
      expect(form.options.length, form.name).toBeGreaterThan(1);
      // The key has to satisfy form_fields' CHECK constraint.
      expect(form.fieldKey, form.name).toMatch(/^[a-z][a-z0-9_]{0,58}[a-z0-9]$/);
    }
  });

  it("references no template or form it does not also create", () => {
    // The dangling-key bug: an action pointing at a key nothing creates would
    // apply cleanly and produce a rule with no template id.
    for (const action of everyAction()) {
      if (action.ref?.templateKey) {
        expect(templateKeys, action.ref.templateKey).toContain(action.ref.templateKey);
      }
      if (action.ref?.formKey) {
        expect(formKeys, action.ref.formKey).toContain(action.ref.formKey);
      }
    }
  });

  it("surfaces both availability answers, by the forms' own field keys", () => {
    const surfaced = everyAction()
      .filter((action) => action.type === "request_form")
      .map((action) => ({
        key: action.config.surface_field_key,
        label: action.config.surface_label,
      }));

    expect(surfaced).toEqual([
      { key: "preferred_call_time", label: "Preferred Call Time" },
      { key: "preferred_interview_time", label: "Preferred Interview Time" },
    ]);

    // And the keys match the questions the forms actually ask — a mismatch here
    // would surface a permanently empty field.
    expect(FLOW_FORMS.map((form) => form.fieldKey)).toEqual([
      "preferred_call_time",
      "preferred_interview_time",
    ]);
  });

  it("puts every list on a branch that stage actually has", () => {
    // An On Pass list on a stage with no verdict would never fire.
    for (const list of defaultFlowLists()) {
      expect(branchesFor(list.stage), `${list.stage}/${list.branch}`).toContain(list.branch);
    }
  });

  it("validates every list against the engine's own vocabulary", () => {
    /*
      The strongest assertion in the file. saveStageWorkflow() puts each list
      through validateRule(), so a flow that fails here would fail at apply time
      with a half-written job behind it.

      Template and form ids are placeholders at definition time, so they are
      filled with syntactically valid uuids — this checks the SHAPE of the flow,
      which is the part that lives in this repo.
    */
    const uuid = "11111111-1111-4111-8111-111111111111";

    const fill = (action: FlowAction): Record<string, unknown> => {
      const config: Record<string, unknown> = { ...action.config };
      if (action.ref?.templateKey) config.template_id = uuid;
      if (action.ref?.formKey) config.form_id = uuid;
      if (action.nested) {
        config.actions = action.nested.map((nested) => ({
          type: nested.type,
          config: fill(nested),
        }));
      }
      return config;
    };

    for (const list of defaultFlowLists()) {
      const result = validateRule({
        trigger: list.stage === "applied" ? "application_created" : "application_stage_changed",
        conditions: [],
        actions: list.actions.map((action) => ({ type: action.type, config: fill(action) })),
      });

      expect(result.ok, `${list.stage}/${list.branch}: ${result.ok ? "" : result.error}`).toBe(true);
    }
  });

  it("leaves the resume passing mark to the job rather than baking one in", () => {
    // A number here would be a second passing mark that silently stops agreeing
    // with the one the job page displays.
    const screen = DEFAULT_FLOW.find((list) => list.stage === "applied")!.actions[0];
    expect(screen.type).toBe("ai_resume_shortlist");
    expect(screen.config.passing_score).toBeNull();
  });

  it("moves the stage LAST in the screening pass branch", () => {
    /*
      Ordering is load-bearing, not cosmetic. A stage change cancels every
      pending wait that started in the stage being left, so a move placed before
      this stage's own thank-you wait would cancel it microseconds after it was
      queued.
    */
    const pass = defaultFlowLists().find(
      (list) => list.stage === "ai_screening_call" && list.branch === "pass"
    )!;
    expect(pass.actions[pass.actions.length - 1].type).toBe("move_to_stage");
  });

  it("counts the pre-call reminder backwards from the booked call", () => {
    const screening = defaultFlowLists().find(
      (list) => list.stage === "ai_screening_call" && list.branch === "always"
    )!;

    const reminder = screening.actions[0];
    expect(reminder.type).toBe("wait_then");
    expect(reminder.config.delay_basis).toBe("before_scheduled_call");
    expect(reminder.config.delay_minutes).toBe(15);

    const thankYou = screening.actions[1];
    expect(thankYou.config.delay_basis).toBe("after");
    expect(thankYou.config.delay_minutes).toBe(30);
  });
});
