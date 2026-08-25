import { describe, expect, it } from "vitest";
import {
  AGENT_PURPOSES,
  LIMITS,
  CONFIGURABLE_SECTIONS,
  DEFAULT_DIAL_CODE,
  canSaveAgent,
  configuredSections,
  defaultAgentSettings,
  isDialableNumber,
  withDialCode,
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

describe("setup progress", () => {
  it("counts the eight CONFIGURABLE sections, not all nine", () => {
    // Test Agent is an action, not a setting. Counting it would leave the
    // indicator permanently short of its own total.
    expect(CONFIGURABLE_SECTIONS).toHaveLength(8);
    expect(CONFIGURABLE_SECTIONS).not.toContain("test");
  });

  it("counts a fresh agent's working defaults as decisions", () => {
    // behavior and handoff ship with real positions (interruption on, transfer
    // deliberately off). Nagging about a section whose defaults are correct
    // teaches people to ignore the indicator.
    const done = configuredSections(defaultAgentSettings({ companyName: "Acme" }));
    expect(done).toContain("behavior");
    expect(done).toContain("handoff");
    expect(done).toContain("greeting");
    expect(done).toContain("brain");
    expect(done).toContain("general");
  });

  it("does NOT count a section whose value is still absent", () => {
    const done = configuredSections(defaultAgentSettings({ companyName: "Acme" }));
    // No voice or recogniser chosen, no call data set.
    expect(done).not.toContain("voice");
    expect(done).not.toContain("speech");
    expect(done).not.toContain("calldata");
  });

  it("counts voice once a real selection exists", () => {
    const settings = normalizeAgentSettings(
      { voice: { voiceKey: "voice_9c1f0ab27d34" } },
      { companyName: "Acme" }
    );
    expect(configuredSections(settings)).toContain("voice");
  });

  it("never reports more sections than exist", () => {
    const full = normalizeAgentSettings(
      {
        voice: { voiceKey: "voice_9c1f0ab27d34" },
        speech: { sttKey: "stt_1122aabbccdd" },
        callData: { fields: [{ key: "company_name", value: "Acme" }] },
      },
      { companyName: "Acme" }
    );
    const done = configuredSections(full);
    expect(done.length).toBeLessThanOrEqual(CONFIGURABLE_SECTIONS.length);
    expect(done).toEqual([...new Set(done)]);
  });
});

describe("caller number", () => {
  it("treats an empty number as valid — the field is optional", () => {
    expect(isDialableNumber(null)).toBe(true);
    expect(isDialableNumber("")).toBe(true);
    expect(isDialableNumber("   ")).toBe(true);
  });

  it("accepts the same number however it is written", () => {
    for (const written of ["+91 98765 43210", "+919876543210", "091-98765-43210", "(022) 6100 4400"]) {
      expect(isDialableNumber(written), written).toBe(true);
    }
  });

  it("rejects too few and too many digits", () => {
    expect(isDialableNumber("12345")).toBe(false);
    // 15 is the E.164 maximum, so 16 is a real ceiling rather than a guess.
    expect(isDialableNumber("1234567890123456")).toBe(false);
  });

  it("adds the dial code only to a bare national number", () => {
    expect(withDialCode("9876543210")).toBe(`${DEFAULT_DIAL_CODE} 9876543210`);
  });

  it("LEAVES a number that already states its country alone", () => {
    // Guessing a country for a number that states one is how a call reaches a
    // stranger.
    expect(withDialCode("+1 415 555 0134")).toBe("+1 415 555 0134");
    expect(withDialCode("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    // A leading trunk zero is a national format, not a bare number.
    expect(withDialCode("09876543210")).toBe("09876543210");
  });

  it("leaves formatted or implausible input alone rather than guessing", () => {
    expect(withDialCode("98765 43210")).toBe("98765 43210");
    expect(withDialCode("12345")).toBe("12345");
    expect(withDialCode("")).toBe("");
  });
});

describe("canSaveAgent — the state change item 1 asked to verify", () => {
  const base = { dirty: false, unsynced: false, callerNumberValid: true };

  it("is OFF on arrival, when nothing has been edited", () => {
    // A muted button here is correct: there is genuinely nothing to save.
    expect(canSaveAgent(base)).toBe(false);
  });

  it("turns ON the moment any field changes", () => {
    /*
      THE BUG THIS GUARDS. The page shipped with a Save that read as permanently
      dead beside a banner promising "you can still configure and save this agent
      now". Editing one field must flip it to full strength.
    */
    expect(canSaveAgent({ ...base, dirty: true })).toBe(true);
  });

  it("stays ON for an unsynced save even with no further edits", () => {
    // Retrying the push to the provider is exactly what the button is for then.
    expect(canSaveAgent({ ...base, unsynced: true })).toBe(true);
  });

  it("is OFF when the caller number is invalid, whatever else is true", () => {
    // Highest priority: an unsaveable value must not be saveable via a dirty form
    // or a pending retry.
    expect(canSaveAgent({ dirty: true, unsynced: false, callerNumberValid: false })).toBe(false);
    expect(canSaveAgent({ dirty: true, unsynced: true, callerNumberValid: false })).toBe(false);
  });

  it("agrees with isDialableNumber, so the field and the button cannot disagree", () => {
    for (const [number, expected] of [
      ["+91 98765 43210", true],
      ["", true],
      ["12345", false],
    ] as const) {
      expect(
        canSaveAgent({ dirty: true, unsynced: false, callerNumberValid: isDialableNumber(number) }),
        number || "(empty)"
      ).toBe(expected);
    }
  });
});
