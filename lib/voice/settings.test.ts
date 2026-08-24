import { describe, expect, it } from "vitest";
import {
  AGENT_PURPOSES,
  LIMITS,
  defaultAgentSettings,
  normalizeAgentSettings,
  normalizeCatalogKey,
  settingsFromRow,
  splitForStorage,
} from "@/lib/voice/settings";

describe("defaults", () => {
  it("produce a working agent, not a form full of blanks", () => {
    const settings = defaultAgentSettings({ companyName: "Webbee Global" });

    expect(settings.general.companyName).toBe("Webbee Global");
    expect(settings.greeting.welcomeMessage.length).toBeGreaterThan(20);
    expect(settings.brain.guardrails.length).toBeGreaterThan(0);
    expect(settings.brain.systemPrompt.length).toBeGreaterThan(20);
  });

  it("fail closed on the two settings that could harm somebody", () => {
    const settings = defaultAgentSettings();

    // An inbound stranger reaching an outbound screening agent is not a feature.
    expect(settings.behavior.rejectUnknownCallers).toBe(true);
    // A handoff with nowhere to hand off to would drop the candidate mid-call.
    expect(settings.handoff.transferEnabled).toBe(false);
    expect(settings.handoff.transferNumber).toBeNull();
  });

  it("cap the call at minutes, not hours", () => {
    const settings = defaultAgentSettings();
    expect(settings.behavior.maxCallMinutes).toBeLessThanOrEqual(15);
    expect(settings.behavior.maxSilenceSeconds).toBeGreaterThanOrEqual(
      LIMITS.silenceSecondsMin
    );
  });
});

// -----------------------------------------------------------------------------
// THE PROVIDER BOUNDARY.
//
// The console's rule is that the neutral object must never contain the provider
// name or any provider-specific identifier. This is the test that keeps it true
// as fields are added, rather than a comment nobody rereads.
// -----------------------------------------------------------------------------
describe("provider neutrality", () => {
  const FORBIDDEN = [
    "bolna",
    "elevenlabs",
    "deepgram",
    "openai",
    "gpt-",
    "twilio",
    "plivo",
    "api_key",
    "apikey",
    "bearer",
  ];

  it("keeps every forbidden term out of the serialised defaults", () => {
    const serialised = JSON.stringify(defaultAgentSettings({ companyName: "Acme" })).toLowerCase();

    for (const term of FORBIDDEN) {
      expect(serialised, `"${term}" must not appear in AgentSettings`).not.toContain(term);
    }
  });

  it("keeps them out of the stored row shape too", () => {
    const stored = JSON.stringify(
      splitForStorage(defaultAgentSettings({ companyName: "Acme" }))
    ).toLowerCase();

    for (const term of FORBIDDEN) {
      expect(stored, `"${term}" must not appear in the stored config`).not.toContain(term);
    }
  });
});

describe("catalogue keys", () => {
  it("accepts the opaque shape the adapter mints", () => {
    expect(normalizeCatalogKey("voice_9c1f0ab27d34")).toBe("voice_9c1f0ab27d34");
    expect(normalizeCatalogKey("amb_0a1b2c")).toBe("amb_0a1b2c");
  });

  it("rejects a provider model name smuggled in through the same field", () => {
    // This is the point of constraining the shape: without it, a hand-edited row
    // could put "gpt-4o-mini" here and the adapter would pass it straight through.
    expect(normalizeCatalogKey("gpt-4o-mini")).toBeNull();
    expect(normalizeCatalogKey("eleven_turbo_v2")).toBeNull();
    expect(normalizeCatalogKey("21m00Tcm4TlvDq8ikWAM")).toBeNull();
    expect(normalizeCatalogKey("")).toBeNull();
    expect(normalizeCatalogKey(null)).toBeNull();
  });
});

describe("normalizeAgentSettings", () => {
  it("never throws, whatever arrives", () => {
    expect(() => normalizeAgentSettings(null)).not.toThrow();
    expect(() => normalizeAgentSettings("nonsense")).not.toThrow();
    expect(() => normalizeAgentSettings({ brain: 7, behavior: [] })).not.toThrow();
  });

  it("clamps rather than rejects, so one bad field cannot lose the other thirty", () => {
    const settings = normalizeAgentSettings({
      brain: { temperature: 40 },
      behavior: { maxCallMinutes: 600, maxSilenceSeconds: 0, interruptionSensitivity: -3 },
      greeting: { welcomeMessage: "Hello there" },
    });

    expect(settings.brain.temperature).toBe(LIMITS.temperatureMax);
    expect(settings.behavior.maxCallMinutes).toBe(LIMITS.callMinutesMax);
    expect(settings.behavior.maxSilenceSeconds).toBe(LIMITS.silenceSecondsMin);
    expect(settings.behavior.interruptionSensitivity).toBe(LIMITS.interruptionMin);
    // The good field survived.
    expect(settings.greeting.welcomeMessage).toBe("Hello there");
  });

  it("rounds a slider value instead of storing floating-point noise", () => {
    const settings = normalizeAgentSettings({
      brain: { temperature: 0.30000000000000004 },
    });
    expect(settings.brain.temperature).toBe(0.3);
  });

  it("switches transfer off when there is no number to transfer to", () => {
    const settings = normalizeAgentSettings({
      handoff: { transferEnabled: true, transferNumber: "   " },
    });

    expect(settings.handoff.transferEnabled).toBe(false);
    expect(settings.handoff.transferNumber).toBeNull();
  });

  it("keeps transfer on when a number is present", () => {
    const settings = normalizeAgentSettings({
      handoff: { transferEnabled: true, transferNumber: "+91 98765 43210" },
    });

    expect(settings.handoff.transferEnabled).toBe(true);
    expect(settings.handoff.transferNumber).toBe("+91 98765 43210");
  });

  it("treats an EMPTY guardrail list as a choice, not as missing", () => {
    // "I'll write my own rules into the prompt" is legitimate. Falling back to the
    // defaults here would silently reinstate rules the admin deleted.
    const settings = normalizeAgentSettings({ brain: { guardrails: [] } });
    expect(settings.brain.guardrails).toEqual([]);
  });

  it("falls back to the defaults when guardrails is not a list at all", () => {
    const settings = normalizeAgentSettings({ brain: { guardrails: "no swearing" } });
    expect(settings.brain.guardrails.length).toBeGreaterThan(0);
  });

  it("drops an unknown purpose and an unknown tone", () => {
    const settings = normalizeAgentSettings({
      general: { purpose: "reconnaissance" },
      brain: { tone: "sarcastic" },
    });

    expect(AGENT_PURPOSES).toContain(settings.general.purpose);
    expect(settings.brain.tone).toBe("professional");
  });

  it("strips anything undialable from a phone number, but does not reformat it", () => {
    // Two separate promises. Letters and markup go, because they cannot be
    // dialled; the punctuation the user typed STAYS, because reformatting to
    // E.164 by guessing a country is how a call reaches a stranger.
    const settings = normalizeAgentSettings({
      general: { callerNumber: "+91 (98765) 43210 ext<script>" },
    });
    expect(settings.general.callerNumber).toBe("+91 (98765) 43210");

    const preserved = normalizeAgentSettings({
      general: { callerNumber: "+91-98765-43210" },
    });
    expect(preserved.general.callerNumber).toBe("+91-98765-43210");
  });

  it("truncates an over-long prompt instead of refusing the save", () => {
    const settings = normalizeAgentSettings({
      brain: { systemPrompt: "x".repeat(LIMITS.systemPromptMax + 500) },
    });
    expect(settings.brain.systemPrompt).toHaveLength(LIMITS.systemPromptMax);
  });

  it("is idempotent — normalising twice changes nothing", () => {
    const once = normalizeAgentSettings({ brain: { temperature: 0.77 } });
    expect(normalizeAgentSettings(once)).toEqual(once);
  });
});

describe("storage round trip", () => {
  it("survives splitForStorage -> settingsFromRow unchanged", () => {
    const settings = normalizeAgentSettings(
      {
        general: { name: "Hindi screener", purpose: "confirmation", callerNumber: "+91 22 1234" },
        greeting: { welcomeMessage: "Namaste {{candidate.name}}" },
        brain: { temperature: 0.45, guardrails: ["No salary talk."] },
        behavior: { maxCallMinutes: 12, ambienceEnabled: true },
        callData: { fields: [{ key: "company_name", value: "Acme" }] },
      },
      { companyName: "Webbee Global" }
    );

    const row = splitForStorage(settings);
    const restored = settingsFromRow(
      {
        name: row.name,
        purpose: row.purpose,
        company_name: row.company_name,
        caller_number: row.caller_number,
        config: row.config,
        default_call_data: row.default_call_data,
      },
      { companyName: "Webbee Global" }
    );

    expect(restored).toEqual(settings);
  });

  it("does NOT duplicate the general fields into the config blob", () => {
    // Two copies of the agent's name would disagree the first time one write path
    // forgot the other, and the switcher reads the column.
    const row = splitForStorage(defaultAgentSettings({ companyName: "Acme" }));
    expect(row.config).not.toHaveProperty("general");
    expect(row.name).toBeTypeOf("string");
  });

  it("keeps default call data in its own column, not in config", () => {
    const row = splitForStorage(defaultAgentSettings());
    expect(row.config).not.toHaveProperty("callData");
    expect(row.default_call_data).toHaveProperty("fallbackQuestions");
  });
});
