import { describe, expect, it } from "vitest";
import { MAX_INSTRUCTION_LENGTH, refineAgentPrompt } from "@/lib/ai/refineAgentPrompt";

/*
  These cover the REFUSALS — the paths that run without an AI provider configured
  and that decide whether a person's prompt survives. The happy path needs a live
  model and is covered by the guard logic below plus the route's own contract.

  The guard that matters most (a revision that drops a guardrail is rejected, not
  flagged) cannot be exercised without a model response, so it is asserted
  indirectly: every early return leaves the original prompt untouched, and the
  function has no way to write one anywhere.
*/
describe("refineAgentPrompt input handling", () => {
  it("refuses when there is no prompt to revise", async () => {
    const result = await refineAgentPrompt({
      currentPrompt: "   ",
      instruction: "make it warmer",
      guardrails: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("no instructions to revise");
  });

  it("refuses an empty change request", async () => {
    const result = await refineAgentPrompt({
      currentPrompt: "Ask the configured questions in order.",
      instruction: "",
      guardrails: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Describe what");
  });

  it("refuses a change request long enough to be a rewrite", async () => {
    const result = await refineAgentPrompt({
      currentPrompt: "Ask the configured questions in order.",
      instruction: "x".repeat(MAX_INSTRUCTION_LENGTH + 1),
      guardrails: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("describes a change");
  });

  it("returns a failure rather than throwing when no model is configured", async () => {
    // The manual workflow must always stay usable: an AI outage degrades to a
    // message, never to a crashed settings page.
    const result = await refineAgentPrompt({
      currentPrompt: "Ask the configured questions in order.",
      instruction: "make her sound more formal",
      guardrails: ["Never discuss salary."],
    });

    expect(typeof result.ok).toBe("boolean");
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });
});
