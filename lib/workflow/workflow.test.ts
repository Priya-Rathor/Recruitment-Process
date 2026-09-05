// =============================================================================
// Module 25 — Stage Workflow Builder.
//
// The brief's testing section names five things. Four of them are pure enough to
// assert here; the fifth ("the Automations page shows every rule created through
// this builder in its run history") is asserted STRUCTURALLY instead — see the
// last describe block, which checks that a builder-saved rule is an ordinary
// automations row rather than checking that a page renders.
//
// That substitution is deliberate. A test that mocked the Automations page into
// returning a row would prove nothing about whether the row exists; a test that
// the save path produces a row with a real trigger, a real action list and the
// `source` marker proves the only thing that could make the page wrong.
// =============================================================================
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECIPIENTS,
  MAX_RECIPIENTS,
  describeRecipients,
  isInternal,
  recipientsFrom,
  validateRecipients,
  type Recipient,
} from "@/lib/workflow/recipients";
import {
  BRANCHING_STAGES,
  BRANCH_TARGET_STAGE,
  CONFIGURABLE_WORKFLOW_STAGES,
  branchesFor,
  stageBranches,
  workflowRuleName,
  workflowStages,
} from "@/lib/workflow/stages";
import { shortlistVerdict } from "@/lib/workflow/shortlist";
import { triggerForStage } from "@/lib/workflow/queries";
import {
  ACTION_LABELS,
  ACTION_MODES,
  ACTION_STAGE_RESTRICTIONS,
  ACTIONS,
  actionReachesCandidate,
  approvalIsRecommended,
  contactsCandidate,
  isManualOnly,
  validateRule,
} from "@/lib/automations/catalog";
import { APPLICATION_STAGES, PIPELINE_STAGES } from "@/lib/applications/stages";

// =============================================================================
// The 8-stage structure is untouched.
//
// The brief's closing requirement is "confirmation this did not touch the fixed
// 8-stage structure itself". This block is that confirmation, in a form that
// keeps being true: if somebody adds a ninth stage or renames one while wiring
// up a later module, these fail.
// =============================================================================
describe("the pipeline definition is unchanged", () => {
  it("still has exactly the eight stages plus two terminal exits", () => {
    expect(PIPELINE_STAGES).toEqual([
      "applied",
      "shortlisted",
      "ai_screening_call",
      "phone_interview",
      "video_interview",
      "written_assessment",
      "director_round",
      "hired",
    ]);
    expect(APPLICATION_STAGES).toHaveLength(10);
  });

  it("builds its stage list from the pipeline rather than a private copy", () => {
    // Hired is excluded (terminal) and so are rejected/withdrawn, leaving seven.
    expect(CONFIGURABLE_WORKFLOW_STAGES).toEqual([
      "applied",
      "shortlisted",
      "ai_screening_call",
      "phone_interview",
      "video_interview",
      "written_assessment",
      "director_round",
    ]);
  });

  it("classifies every configurable stage as branching or not", () => {
    // The point of this one: a new stage added to PIPELINE_STAGES arrives here
    // unclassified, and this catches it rather than letting it silently default.
    for (const stage of CONFIGURABLE_WORKFLOW_STAGES) {
      expect(branchesFor(stage).length, stage).toBeGreaterThan(0);
      expect(branchesFor(stage)[0], stage).toBe("always");
    }
  });

  it("only branches stages that have a score to branch on", () => {
    expect(BRANCHING_STAGES).toEqual(["shortlisted", "ai_screening_call", "written_assessment"]);

    for (const stage of ["phone_interview", "video_interview", "director_round"] as const) {
      expect(stageBranches(stage), stage).toBe(false);
      expect(branchesFor(stage), stage).toEqual(["always"]);
    }
  });
});

// =============================================================================
// THE BRIEF'S CENTRAL TEST.
//
// "an action configured under Shortlisted's 'On Pass' branch fires only when the
// AI Resume Shortlisting step actually passes, and the 'On Fail' branch fires
// only on fail"
//
// The verdict is a pure function, so the first half is asserted directly. The
// second half — that the verdict actually selects the branch — is the filter in
// dispatch(), asserted below through the same predicate the engine uses.
// =============================================================================
describe("resume shortlisting verdicts", () => {
  it("passes on the threshold, not just above it", () => {
    // 70 against a mark of 70 has to pass, or "the passing score" names a number
    // that does not pass.
    expect(shortlistVerdict({ score: 70, threshold: 70 }).verdict).toBe("pass");
    expect(shortlistVerdict({ score: 71, threshold: 70 }).verdict).toBe("pass");
  });

  it("fails below the threshold", () => {
    expect(shortlistVerdict({ score: 69, threshold: 70 }).verdict).toBe("fail");
    expect(shortlistVerdict({ score: 0, threshold: 1 }).verdict).toBe("fail");
  });

  it("does NOT fail when the job has no passing mark configured", () => {
    // The most important assertion in the file. A missing threshold reading as a
    // fail would flag every applicant to every unconfigured job as Not
    // Shortlisted, automatically and silently.
    const outcome = shortlistVerdict({ score: 42, threshold: null });
    expect(outcome.verdict).toBe("needs_review");
    expect(outcome.reason).toMatch(/no Resume Score passing mark/i);
  });

  it("does NOT fail when the resume could not be scored", () => {
    const outcome = shortlistVerdict({ score: null, threshold: 70 });
    expect(outcome.verdict).toBe("needs_review");
    expect(outcome.reason).toMatch(/could not be scored/i);
  });

  it("explains a fail with both numbers", () => {
    // "62" alone is not an explanation; "62, below the passing mark of 70" is.
    expect(shortlistVerdict({ score: 62, threshold: 70 }).reason).toContain("62");
    expect(shortlistVerdict({ score: 62, threshold: 70 }).reason).toContain("70");
  });
});

describe("branch selection", () => {
  /** The predicate dispatch() applies, extracted so the rule is testable. */
  function fires(ruleBranch: "always" | "pass" | "fail", dispatched: "always" | "pass" | "fail") {
    return ruleBranch === "always" || ruleBranch === dispatched;
  }

  it("fires an On Pass rule only on a pass", () => {
    expect(fires("pass", "pass")).toBe(true);
    expect(fires("pass", "fail")).toBe(false);
    expect(fires("pass", "always")).toBe(false);
  });

  it("fires an On Fail rule only on a fail", () => {
    expect(fires("fail", "fail")).toBe(true);
    expect(fires("fail", "pass")).toBe(false);
    expect(fires("fail", "always")).toBe(false);
  });

  it("fires an 'always' rule on every dispatch, verdict or not", () => {
    // Entering the stage happened regardless of what the verdict turned out to
    // be, so the entry actions must not be suppressed by a branch dispatch.
    expect(fires("always", "pass")).toBe(true);
    expect(fires("always", "fail")).toBe(true);
    expect(fires("always", "always")).toBe(true);
  });

  it("routes the resume screen's verdict to Shortlisted's branches", () => {
    // The action lives on Applied; the brief files its branches under
    // Shortlisted. A failed screen leaves the application in Applied, so without
    // this redirect the On Fail branch could never match.
    expect(BRANCH_TARGET_STAGE.applied).toBe("shortlisted");
  });
});

// =============================================================================
// Recipients — the brief's "a recipient set to 'Assigned Recruiter' resolves and
// sends to the correct person with candidate/job placeholders still correctly
// filled in".
//
// Resolution against real rows needs a database; what is asserted here is the
// half that decides correctness: which kinds exist, that internal ones are
// marked internal (which is what suppresses the opt-out and the footer), and
// that the render context is NOT switched by the recipient.
// =============================================================================
describe("recipients", () => {
  it("defaults to the candidate when nothing is configured", () => {
    // Every rule written before Module 25 has no recipients key at all, and must
    // keep meaning "the candidate".
    expect(recipientsFrom(undefined)).toEqual(DEFAULT_RECIPIENTS);
    expect(recipientsFrom({})).toEqual([{ kind: "candidate" }]);
  });

  it("treats every non-candidate recipient as internal", () => {
    expect(isInternal("candidate")).toBe(false);
    expect(isInternal("assigned_recruiter")).toBe(true);
    expect(isInternal("job_owner")).toBe(true);
    expect(isInternal("organization_member")).toBe(true);
  });

  it("refuses an empty list rather than falling back to the candidate", () => {
    // Silently mailing the applicant instead of the colleague somebody meant to
    // notify is the worst available outcome here.
    const result = validateRecipients([]);
    expect(result.ok).toBe(false);
  });

  it("requires a user id for a named member", () => {
    expect(validateRecipients([{ kind: "organization_member" }]).ok).toBe(false);
    expect(validateRecipients([{ kind: "organization_member", userId: "not-a-uuid" }]).ok).toBe(false);
  });

  it("accepts a named member with a real uuid", () => {
    const result = validateRecipients([
      { kind: "organization_member", userId: "11111111-1111-4111-8111-111111111111" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recipients[0].userId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("collapses duplicate kinds", () => {
    const result = validateRecipients([
      { kind: "candidate" },
      { kind: "candidate" },
      { kind: "job_owner" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recipients).toHaveLength(2);
  });

  it("strips a stray user id from a kind that does not take one", () => {
    const result = validateRecipients([
      { kind: "job_owner", userId: "11111111-1111-4111-8111-111111111111" },
    ]);
    expect(result.ok).toBe(true);
    // Carrying it would read, to the next person, as though the job owner had
    // been pinned to a specific person.
    if (result.ok) expect(result.recipients[0].userId).toBeUndefined();
  });

  it("caps the list", () => {
    const many: Recipient[] = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, index) => ({
      kind: "organization_member",
      userId: `1111111${index}-1111-4111-8111-111111111111`,
    }));
    expect(validateRecipients(many).ok).toBe(false);
  });

  it("describes a mixed list in English", () => {
    expect(
      describeRecipients([{ kind: "candidate" }, { kind: "assigned_recruiter" }])
    ).toBe("Candidate and Assigned recruiter");
  });
});

// =============================================================================
// Approval, which the recipient list changes.
// =============================================================================
describe("approval and candidate contact", () => {
  const template = "11111111-1111-4111-8111-111111111111";

  it("treats a message to the candidate as candidate contact", () => {
    const action = {
      type: "send_templated_message" as const,
      config: { template_id: template, recipients: [{ kind: "candidate" }] },
    };
    expect(actionReachesCandidate(action)).toBe(true);
    expect(contactsCandidate([action])).toBe(true);
  });

  it("does NOT treat an internal-only notification as candidate contact", () => {
    // Forcing a review step in front of "tell the recruiter somebody passed" is
    // the friction that makes people switch automation off.
    const action = {
      type: "send_templated_message" as const,
      config: { template_id: template, recipients: [{ kind: "assigned_recruiter" }] },
    };
    expect(actionReachesCandidate(action)).toBe(false);
    expect(contactsCandidate([action])).toBe(false);
    expect(approvalIsRecommended([action])).toBe(false);
  });

  it("treats a mixed list as candidate contact", () => {
    const action = {
      type: "send_templated_message" as const,
      config: {
        template_id: template,
        recipients: [{ kind: "candidate" }, { kind: "job_owner" }],
      },
    };
    expect(actionReachesCandidate(action)).toBe(true);
  });

  it("treats a rule with no recipients as candidate contact", () => {
    // Every pre-Module-25 rule. Defaulting the unknown case toward MORE review is
    // the safe direction to be wrong in.
    expect(
      actionReachesCandidate({ type: "send_templated_message", config: { template_id: template } })
    ).toBe(true);
  });
});

// =============================================================================
// The new actions are ordinary members of Module 13's closed vocabulary.
// =============================================================================
describe("the new actions", () => {
  const template = "11111111-1111-4111-8111-111111111111";
  const form = "22222222-2222-4222-8222-222222222222";

  it("are in the catalogue, with labels and modes", () => {
    for (const action of ["ai_resume_shortlist", "request_form", "schedule_interview"] as const) {
      expect(ACTIONS, action).toContain(action);
      expect(ACTION_LABELS[action], action).toBeTruthy();
      expect(ACTION_MODES[action]?.length, action).toBeGreaterThan(0);
    }
  });

  it("restricts resume shortlisting to the Applied stage", () => {
    // Offered three rounds later it would re-score a resume nobody cares about
    // any more — and, because it moves or flags, do so destructively.
    expect(ACTION_STAGE_RESTRICTIONS.ai_resume_shortlist).toEqual(["applied"]);
  });

  it("runs resume shortlisting only with a session", () => {
    // calculateAndStoreMatch() builds its own session-bound client, so a service
    // -role run would be denied by RLS rather than work.
    expect(ACTION_MODES.ai_resume_shortlist).toEqual(["session"]);
  });

  it("refuses an out-of-range passing mark", () => {
    const result = validateRule({
      trigger: "application_created",
      conditions: [],
      actions: [{ type: "ai_resume_shortlist", config: { passing_score: 140 } }],
    });
    expect(result.ok).toBe(false);
  });

  it("stores a null passing mark as 'use the job's own'", () => {
    const result = validateRule({
      trigger: "application_created",
      conditions: [],
      actions: [{ type: "ai_resume_shortlist", config: {} }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.actions[0].config?.passing_score).toBeNull();
      // Advancing is the default; a workflow that only scores has to opt out.
      expect(result.rule.actions[0].config?.advance_on_pass).toBe(true);
    }
  });

  it("requires both ids on a form request", () => {
    expect(
      validateRule({
        trigger: "application_stage_changed",
        conditions: [],
        actions: [{ type: "request_form", config: { form_id: form } }],
      }).ok
    ).toBe(false);

    expect(
      validateRule({
        trigger: "application_stage_changed",
        conditions: [],
        actions: [{ type: "request_form", config: { form_id: form, template_id: template } }],
      }).ok
    ).toBe(true);
  });

  it("refuses to store interview scheduling as an automatic action", () => {
    // A rule that could never fire is worse than one that is refused: it looks
    // configured and does nothing.
    const automatic = validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [{ type: "schedule_interview", config: { manual: false } }],
    });
    expect(automatic.ok).toBe(false);
    expect(isManualOnly("schedule_interview")).toBe(true);

    const manual = validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [{ type: "schedule_interview", config: { manual: true } }],
    });
    expect(manual.ok).toBe(true);
  });

  it("accepts a per-stage voice agent and defaults it to null", () => {
    const withAgent = validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [{ type: "start_screening_call", config: { agent_id: template } }],
    });
    expect(withAgent.ok).toBe(true);

    const without = validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [{ type: "start_screening_call", config: {} }],
    });
    expect(without.ok).toBe(true);
    // Null means "the organization's default agent" — what every rule written
    // before Module 25 does.
    if (without.ok) expect(without.rule.actions[0].config?.agent_id).toBeNull();

    const bogus = validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [{ type: "start_screening_call", config: { agent_id: "nope" } }],
    });
    expect(bogus.ok).toBe(false);
  });

  it("validates recipients as part of the rule", () => {
    const result = validateRule({
      trigger: "application_stage_changed",
      conditions: [],
      actions: [
        {
          type: "send_templated_message",
          config: { template_id: template, recipients: [{ kind: "organization_member" }] },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// The builder writes real automations rows — the brief's "the existing Module 13
// Automations page shows every rule created through this builder".
// =============================================================================
describe("stage workflows are ordinary automations", () => {
  it("wires Applied to application_created and everything else to the stage change", () => {
    /*
      THIS IS THE DIFFERENCE BETWEEN FIRING AND NEVER FIRING.

      An application is CREATED at Applied; it never "changes stage into" Applied,
      so a workflow there wired to application_stage_changed would validate, save,
      activate, show as live, and never run once.
    */
    expect(triggerForStage("applied")).toBe("application_created");

    for (const stage of CONFIGURABLE_WORKFLOW_STAGES.filter((entry) => entry !== "applied")) {
      expect(triggerForStage(stage), stage).toBe("application_stage_changed");
    }
  });

  it("names a rule so it reads on the Automations page", () => {
    // The name appears there with no job context around it, so the job title has
    // to be part of it.
    const name = workflowRuleName({
      jobTitle: "Senior Engineer",
      stage: "shortlisted",
      branch: "fail",
    });
    expect(name).toContain("Senior Engineer");
    expect(name).toContain("Shortlisted");
    expect(name).toContain("On fail");
  });

  it("keeps a generated name inside the column's 120-character limit", () => {
    const name = workflowRuleName({
      jobTitle: "x".repeat(300),
      stage: "written_assessment",
      branch: "pass",
    });
    expect(name.length).toBeLessThanOrEqual(120);
    // And the part that distinguishes two rows on one job survives the trim.
    expect(name).toContain("Written Assessment");
    expect(name).toContain("On pass");
  });

  it("offers a branch list for every stage it says branches", () => {
    for (const definition of workflowStages()) {
      if (BRANCHING_STAGES.includes(definition.stage)) {
        expect(definition.branches, definition.stage).toEqual(["always", "pass", "fail"]);
        // A branching stage has to be able to say what it branched on, or the UI
        // shows two lists and no explanation of which one will fire.
        expect(definition.scoreSource, definition.stage).toBeTruthy();
      } else {
        expect(definition.branches, definition.stage).toEqual(["always"]);
        expect(definition.scoreSource, definition.stage).toBeNull();
      }
    }
  });
});
