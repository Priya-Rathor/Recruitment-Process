import { describe, expect, it } from "vitest";
import {
  AMBIENCE_TRACKS,
  ambienceOptions,
  buildSystemPrompt,
  extractCatalogArray,
  interruptionWords,
  mintCatalogKey,
  parseCatalogEntry,
  resolveCatalogKey,
  sanitizeLabel,
  toProviderAgentPayload,
} from "@/lib/integrations/bolna/agentMapping";
import { defaultAgentSettings, normalizeAgentSettings } from "@/lib/voice/settings";

const WEBHOOK = "https://app.example.com/api/webhooks/bolna";

/** Digs a nested path out of the payload, so the assertions read as the shape. */
function at(payload: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node === null || typeof node !== "object") return undefined;
    // Array indices in the path, e.g. "tasks.0.task_config".
    return (node as Record<string, unknown>)[key];
  }, payload);
}

describe("sanitizeLabel", () => {
  it("removes provider words from a catalogue label", () => {
    expect(sanitizeLabel("Bolna Default")).toBe("Default");
    expect(sanitizeLabel("Aditi (ElevenLabs)")).toBe("Aditi");
    expect(sanitizeLabel("deepgram-nova-2")).toBe("2");
  });

  it("returns null for a label that was ONLY a provider term", () => {
    // The caller drops the option: nine named voices beat ten where one is "".
    expect(sanitizeLabel("bolna")).toBeNull();
    expect(sanitizeLabel("  OpenAI  ")).toBeNull();
  });

  it("leaves an ordinary human name alone", () => {
    expect(sanitizeLabel("Aditi")).toBe("Aditi");
    expect(sanitizeLabel("Hindi (India)")).toBe("Hindi (India)");
  });

  it("refuses anything that is not a string", () => {
    expect(sanitizeLabel(undefined)).toBeNull();
    expect(sanitizeLabel(42)).toBeNull();
  });
});

describe("catalogue keys", () => {
  it("are deterministic, so a stored selection still resolves tomorrow", () => {
    expect(mintCatalogKey("voice", "21m00Tcm4TlvDq8ikWAM")).toBe(
      mintCatalogKey("voice", "21m00Tcm4TlvDq8ikWAM")
    );
  });

  it("are namespaced by kind, so a voice and a model never collide", () => {
    expect(mintCatalogKey("voice", "same-id")).not.toBe(mintCatalogKey("model", "same-id"));
  });

  it("leak nothing about the identifier they were minted from", () => {
    const key = mintCatalogKey("model", "gpt-4o-mini");
    expect(key).toMatch(/^model_[0-9a-f]{12}$/);
    expect(key).not.toContain("gpt");
    expect(key).not.toContain("mini");
  });

  it("round-trip back to the provider id via the live catalogue", () => {
    const ids = ["voice-a", "voice-b", "voice-c"];
    const key = mintCatalogKey("voice", "voice-b");
    expect(resolveCatalogKey("voice", key, ids)).toBe("voice-b");
  });

  it("resolve to null for a retired option rather than to a stale id", () => {
    const key = mintCatalogKey("voice", "voice-removed");
    expect(resolveCatalogKey("voice", key, ["voice-a"])).toBeNull();
    expect(resolveCatalogKey("voice", null, ["voice-a"])).toBeNull();
  });
});

describe("ambience options", () => {
  it("expose keys the neutral settings normaliser will accept", () => {
    for (const option of ambienceOptions()) {
      expect(option.key).toMatch(/^amb_[0-9a-f]{12}$/);
    }
  });

  it("show a place, not a track filename", () => {
    const labels = ambienceOptions().map((option) => option.label);
    expect(labels).toContain("Coffee shop");
    for (const label of labels) {
      expect(label).not.toContain("-");
      expect(label).not.toContain("_");
    }
  });
});

describe("interruptionWords", () => {
  it("INVERTS sensitivity — high sensitivity means a low word threshold", () => {
    // Getting this backwards produces an agent that talks over everybody at the
    // setting labelled "most responsive".
    expect(interruptionWords(1)).toBeLessThan(interruptionWords(0));
  });

  it("never returns zero, which would cut the agent off before it spoke", () => {
    expect(interruptionWords(1)).toBeGreaterThanOrEqual(1);
    expect(interruptionWords(5)).toBeGreaterThanOrEqual(1);
  });

  it("clamps out-of-range input", () => {
    expect(interruptionWords(-4)).toBe(interruptionWords(0));
    expect(interruptionWords(99)).toBe(interruptionWords(1));
  });
});

describe("buildSystemPrompt", () => {
  it("puts the guardrails LAST, where a model weights them most", () => {
    const settings = normalizeAgentSettings({
      brain: {
        persona: "A recruitment coordinator.",
        systemPrompt: "Ask the questions in order.",
        guardrails: ["Never state a hiring decision."],
      },
    });

    const prompt = buildSystemPrompt(settings);
    expect(prompt.indexOf("Never state a hiring decision.")).toBeGreaterThan(
      prompt.indexOf("Ask the questions in order.")
    );
  });

  it("names the company when one is set", () => {
    const settings = normalizeAgentSettings(
      { general: { name: "Screener" } },
      { companyName: "Webbee Global" }
    );
    expect(buildSystemPrompt(settings)).toContain("Webbee Global");
  });

  it("does NOT contain the consent disclosure", () => {
    // The disclosure is a legal obligation emitted as a spoken segment by
    // lib/screening/script.ts. In a prompt it would be something an LLM might
    // paraphrase away.
    const prompt = buildSystemPrompt(defaultAgentSettings()).toLowerCase();
    expect(prompt).not.toContain("may be recorded");
  });

  it("mentions the transfer only when transfer is enabled", () => {
    const off = buildSystemPrompt(defaultAgentSettings());
    expect(off).not.toContain("transfer");

    const on = buildSystemPrompt(
      normalizeAgentSettings({
        handoff: { transferEnabled: true, transferNumber: "+91 98765 43210" },
      })
    );
    expect(on).toContain("transfer");
  });
});

// -----------------------------------------------------------------------------
// THE MAPPING.
//
// These assertions are the contract: each neutral field lands in one named
// provider field. What they cannot prove is that the provider's live schema still
// matches its documentation — that needs one staging call with the payload logged.
// -----------------------------------------------------------------------------
describe("toProviderAgentPayload", () => {
  const ids = { model: null, voice: null, stt: null, ambienceTrack: null };

  it("maps the behaviour section field by field", () => {
    const settings = normalizeAgentSettings({
      behavior: {
        maxSilenceSeconds: 15,
        maxCallMinutes: 6,
        aiDecidedHangup: false,
        voicemailDetection: false,
        backchanneling: false,
        allowInterruption: true,
        interruptionSensitivity: 1,
      },
    });

    const payload = toProviderAgentPayload({ settings, ids, webhookUrl: WEBHOOK });
    const task = at(payload, "agent_config.tasks.0.task_config") as Record<string, unknown>;

    expect(task.hangup_after_silence).toBe(15);
    // Minutes on our side, SECONDS on theirs. The unit conversion is the kind of
    // thing that silently ends calls six times too early.
    expect(task.call_terminate).toBe(360);
    expect(task.hangup_after_LLMCall).toBe(false);
    expect(task.voicemail).toBe(false);
    expect(task.backchanneling).toBe(false);
    expect(task.number_of_words_for_interruption).toBe(interruptionWords(1));
  });

  it("expresses 'interruption off' as an unreachable threshold, not a boolean", () => {
    // A provider that ignores an unknown boolean would otherwise leave
    // interruption ON, and "the agent talks over the candidate" is the complaint.
    const settings = normalizeAgentSettings({ behavior: { allowInterruption: false } });
    const payload = toProviderAgentPayload({ settings, ids, webhookUrl: WEBHOOK });
    const task = at(payload, "agent_config.tasks.0.task_config") as Record<string, unknown>;

    expect(task.number_of_words_for_interruption).toBe(999);
  });

  it("carries the greeting and the webhook", () => {
    const settings = normalizeAgentSettings({
      general: { name: "Hindi screener" },
      greeting: { welcomeMessage: "Namaste" },
    });
    const payload = toProviderAgentPayload({ settings, ids, webhookUrl: WEBHOOK });

    expect(at(payload, "agent_config.agent_name")).toBe("Hindi screener");
    expect(at(payload, "agent_config.agent_welcome_message")).toBe("Namaste");
    expect(at(payload, "agent_config.webhook_url")).toBe(WEBHOOK);
  });

  it("turns response length into a token ceiling, not just prompt wording", () => {
    const short = toProviderAgentPayload({
      settings: normalizeAgentSettings({ brain: { responseLength: "short" } }),
      ids,
      webhookUrl: WEBHOOK,
    });
    const long = toProviderAgentPayload({
      settings: normalizeAgentSettings({ brain: { responseLength: "long" } }),
      ids,
      webhookUrl: WEBHOOK,
    });

    const tokens = (payload: Record<string, unknown>) =>
      at(payload, "agent_config.tasks.0.tools_config.llm_agent.llm_config.max_tokens") as number;

    expect(tokens(short)).toBeLessThan(tokens(long));
  });

  it("carries the temperature verbatim", () => {
    const settings = normalizeAgentSettings({ brain: { temperature: 0.15 } });
    const payload = toProviderAgentPayload({ settings, ids, webhookUrl: WEBHOOK });

    expect(
      at(payload, "agent_config.tasks.0.tools_config.llm_agent.llm_config.temperature")
    ).toBe(0.15);
  });

  it("OMITS a provider id rather than sending null when nothing was chosen", () => {
    // An explicit null overrides the account default on some providers, which is
    // not what "platform default" means.
    const payload = toProviderAgentPayload({
      settings: defaultAgentSettings(),
      ids,
      webhookUrl: WEBHOOK,
    });

    const llm = at(payload, "agent_config.tasks.0.tools_config.llm_agent.llm_config") as Record<
      string,
      unknown
    >;
    const synth = at(payload, "agent_config.tasks.0.tools_config.synthesizer") as Record<
      string,
      unknown
    >;

    expect(llm).not.toHaveProperty("model");
    expect(synth).not.toHaveProperty("provider_config");
  });

  it("includes the resolved ids when they were chosen", () => {
    const payload = toProviderAgentPayload({
      settings: defaultAgentSettings(),
      ids: { model: "a-model", voice: "a-voice", stt: "a-transcriber", ambienceTrack: null },
      webhookUrl: WEBHOOK,
    });

    expect(
      at(payload, "agent_config.tasks.0.tools_config.llm_agent.llm_config.model")
    ).toBe("a-model");
    expect(
      at(payload, "agent_config.tasks.0.tools_config.synthesizer.provider_config.voice_id")
    ).toBe("a-voice");
    expect(at(payload, "agent_config.tasks.0.tools_config.transcriber.model")).toBe(
      "a-transcriber"
    );
  });

  it("only switches ambience on when a track actually resolved", () => {
    const enabledNoTrack = toProviderAgentPayload({
      settings: normalizeAgentSettings({ behavior: { ambienceEnabled: true } }),
      ids,
      webhookUrl: WEBHOOK,
    });
    const task = at(enabledNoTrack, "agent_config.tasks.0.task_config") as Record<string, unknown>;
    expect(task.ambient_noise).toBe(false);
    expect(task).not.toHaveProperty("ambient_noise_track");

    const withTrack = toProviderAgentPayload({
      settings: normalizeAgentSettings({
        behavior: {
          ambienceEnabled: true,
          ambienceTrackKey: mintCatalogKey("amb", AMBIENCE_TRACKS[0].id),
        },
      }),
      ids: { ...ids, ambienceTrack: AMBIENCE_TRACKS[0].id },
      webhookUrl: WEBHOOK,
    });
    const withTask = at(withTrack, "agent_config.tasks.0.task_config") as Record<string, unknown>;
    expect(withTask.ambient_noise).toBe(true);
    expect(withTask.ambient_noise_track).toBe(AMBIENCE_TRACKS[0].id);
  });

  it("omits the transfer block entirely when handoff is off", () => {
    const payload = toProviderAgentPayload({
      settings: defaultAgentSettings(),
      ids,
      webhookUrl: WEBHOOK,
    });
    const task = at(payload, "agent_config.tasks.0.task_config") as Record<string, unknown>;
    expect(task).not.toHaveProperty("call_transfer");
  });

  it("includes the transfer number when handoff is on", () => {
    const payload = toProviderAgentPayload({
      settings: normalizeAgentSettings({
        handoff: { transferEnabled: true, transferNumber: "+91 98765 43210" },
      }),
      ids,
      webhookUrl: WEBHOOK,
    });

    expect(at(payload, "agent_config.tasks.0.task_config.call_transfer.transfer_number")).toBe(
      "+91 98765 43210"
    );
  });

  it("puts the assembled prompt where the provider reads it", () => {
    const settings = normalizeAgentSettings({
      brain: { guardrails: ["Never discuss salary."] },
    });
    const payload = toProviderAgentPayload({ settings, ids, webhookUrl: WEBHOOK });

    expect(at(payload, "agent_prompts.task_1.system_prompt")).toContain("Never discuss salary.");
  });

  it("is serialisable — no undefined-valued keys, no cycles", () => {
    const payload = toProviderAgentPayload({
      settings: defaultAgentSettings(),
      ids,
      webhookUrl: WEBHOOK,
    });
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.stringify(payload)).not.toContain("undefined");
  });
});

describe("catalogue parsing", () => {
  it("reads the shapes providers actually return", () => {
    expect(extractCatalogArray([1, 2])).toEqual([1, 2]);
    expect(extractCatalogArray({ data: ["a"] })).toEqual(["a"]);
    expect(extractCatalogArray({ voices: ["a"] })).toEqual(["a"]);
    expect(extractCatalogArray({ models: ["a"] })).toEqual(["a"]);
  });

  it("degrades to an empty list rather than throwing on an unknown shape", () => {
    expect(extractCatalogArray(null)).toEqual([]);
    expect(extractCatalogArray("nope")).toEqual([]);
    expect(extractCatalogArray({ unexpected: { nested: true } })).toEqual([]);
  });

  it("parses a bare string entry", () => {
    const parsed = parseCatalogEntry("voice", "Aditi");
    expect(parsed?.option.label).toBe("Aditi");
    expect(parsed?.sourceId).toBe("Aditi");
  });

  it("prefers a display name over an internal id for the label", () => {
    const parsed = parseCatalogEntry("voice", {
      voice_id: "21m00Tcm4TlvDq8ikWAM",
      name: "Aditi",
      language: "Hindi",
    });

    expect(parsed?.option.label).toBe("Aditi");
    expect(parsed?.option.language).toBe("Hindi");
    // The internal id is what the key was minted from, but never what is shown.
    expect(parsed?.sourceId).toBe("21m00Tcm4TlvDq8ikWAM");
    expect(parsed?.option.key).not.toContain("21m00");
  });

  it("joins a language array for display", () => {
    const parsed = parseCatalogEntry("stt", {
      id: "model-1",
      name: "Standard",
      languages: ["English", "Hindi"],
    });
    expect(parsed?.option.language).toBe("English, Hindi");
  });

  it("returns null for an entry with nothing usable", () => {
    expect(parseCatalogEntry("voice", {})).toBeNull();
    expect(parseCatalogEntry("voice", null)).toBeNull();
    expect(parseCatalogEntry("voice", { id: "bolna" })).toBeNull();
  });
});
