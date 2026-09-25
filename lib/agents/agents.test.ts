import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_TYPES,
  AGENT_TYPE_META,
  EXTERNALLY_MANAGED,
  allowedStatuses,
  isAgentType,
} from "./types";
import { PROVIDERS, providersFor, supportsVoiceInterview, supportsVoiceScreening } from "./providers";
import {
  CONFIG_FIELDS,
  countAgentUsage,
  isAgentInUseError,
  normalizeAgentInput,
  normalizeConfiguration,
} from "./config";
import { decideDialingAgent } from "@/lib/voice/dialing";

const MIGRATION = readFileSync(
  path.join(process.cwd(), "supabase/migrations/0043_agent_center.sql"),
  "utf8"
);

describe("agent types", () => {
  it("maps every type to the specified name and icon, and nothing else", () => {
    // The brief's table, verbatim. An icon swapped for a robot or a brain
    // would pass a looser test.
    const expected: Record<string, [string, string]> = {
      voice_screening: ["Voice Screening Agent", "PhoneCall"],
      voice_interview: ["Voice Interview Agent", "Mic"],
      video_interview: ["Video Interview Agent", "Video"],
      whatsapp_reply: ["WhatsApp Auto Reply Agent", "MessageCircle"],
      email_reply: ["Email Auto Reply Agent", "Mail"],
      assessment: ["Assessment Agent", "ClipboardCheck"],
      universal: ["Universal Agent", "Orbit"],
      custom_llm: ["Custom LLM Agent", "Braces"],
    };
    expect([...AGENT_TYPES].sort()).toEqual(Object.keys(expected).sort());
    for (const type of AGENT_TYPES) {
      const meta = AGENT_TYPE_META[type];
      expect(meta.label, type).toBe(expected[type][0]);
      expect((meta.icon as { displayName?: string }).displayName, type).toBe(expected[type][1]);
    }
  });

  it("is a closed set — arbitrary strings are not types", () => {
    expect(isAgentType("voice_screening")).toBe(true);
    expect(isAgentType("VOICE_SCREENING")).toBe(false);
    expect(isAgentType("robot")).toBe(false);
    expect(isAgentType(undefined)).toBe(false);
  });

  it("matches the database enum exactly", () => {
    const enumBody = MIGRATION.match(/create type public\.agent_type as enum \(([\s\S]*?)\);/)?.[1] ?? "";
    const values = [...enumBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...AGENT_TYPES]);
  });

  it("lets ACTIVE only the types the database lets be active", () => {
    // `runnable` is the readable copy of agents_status_runnable. If an engine
    // module widens one and not the other, the UI offers a status the database
    // refuses — or refuses one it would accept.
    const check = MIGRATION.match(/agents_status_runnable check \(([\s\S]*?)\)\s*,/)?.[1] ?? "";
    const allowed = [...check.matchAll(/type = '([a-z_]+)'/g)].map((m) => m[1]);
    const runnableInAgentsTable = AGENT_TYPES.filter(
      (type) => AGENT_TYPE_META[type].runnable && !EXTERNALLY_MANAGED[type]
    );
    expect(allowed.sort()).toEqual([...runnableInAgentsTable].sort());
  });

  it("offers ACTIVE and PAUSED only where something runs the agent", () => {
    expect(allowedStatuses("voice_screening")).toContain("active");
    for (const type of ["voice_interview", "video_interview", "email_reply", "assessment", "universal", "custom_llm"] as const) {
      expect(allowedStatuses(type), type).toEqual(["draft", "archived"]);
      expect(AGENT_TYPE_META[type].blockedReason, type).toBeTruthy();
    }
  });
});

describe("providers — a separate axis with a real capability matrix", () => {
  it("never assumes every provider supports every type", () => {
    for (const provider of Object.values(PROVIDERS)) {
      expect(provider.capabilities.length, provider.id).toBeLessThan(AGENT_TYPES.length);
      for (const capability of provider.capabilities) expect(capability.evidence, provider.id).toBeTruthy();
    }
  });

  it("offers voice providers for voice types and none for anything else", () => {
    expect(providersFor("voice_screening").map((p) => p.id)).toEqual(["bolna", "sarvam"]);
    expect(providersFor("video_interview")).toEqual([]);
    expect(providersFor("assessment")).toEqual([]);
    expect(supportsVoiceScreening("bolna")).toBe(true);
    expect(supportsVoiceInterview("sarvam")).toBe(true);
  });

  it("marks Sarvam as documented but not built, rather than hiding or faking it", () => {
    expect(PROVIDERS.sarvam.adapter).toBe("not_built");
    expect(PROVIDERS.bolna.adapter).toBe("built");
  });

  it("requires a provider in the database exactly where the types take one", () => {
    const check = MIGRATION.match(/agents_provider_matches_type check \(([\s\S]*?)\n  \),/)?.[1] ?? "";
    const withProvider = [...(check.match(/type in \(([^)]*)\) and provider is not null/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1]
    );
    const typesWithProviders = AGENT_TYPES.filter((type) => providersFor(type).length > 0);
    expect(withProvider.sort()).toEqual([...typesWithProviders].sort());
  });
});

describe("normalizeAgentInput", () => {
  const voice = {
    type: "voice_screening",
    provider: "bolna",
    name: "Technical screen",
    configuration: { instructions: "Ask the questions in order." },
  };

  it("accepts a complete voice screening agent", () => {
    const result = normalizeAgentInput(voice);
    expect(result.ok && result.value).toMatchObject({ type: "voice_screening", provider: "bolna", name: "Technical screen" });
  });

  it("never carries a client-supplied organization or status through", () => {
    const result = normalizeAgentInput({ ...voice, organization_id: "someone-else", status: "active", created_by: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual(["configuration", "description", "name", "provider", "type"]);
  });

  it("refuses a missing provider, an unsupported one, and one with no adapter", () => {
    expect(normalizeAgentInput({ ...voice, provider: undefined }).ok).toBe(false);
    expect(normalizeAgentInput({ ...voice, provider: "twilio" }).ok).toBe(false);
    const sarvam = normalizeAgentInput({ ...voice, provider: "sarvam" });
    expect(sarvam.ok === false && sarvam.error).toMatch(/isn't available/);
  });

  it("refuses a provider on a type that doesn't take one", () => {
    expect(normalizeAgentInput({ type: "assessment", provider: "bolna", name: "x", configuration: {} }).ok).toBe(false);
  });

  it("allows a video interview draft with no provider — there is none to choose", () => {
    const result = normalizeAgentInput({
      type: "video_interview",
      name: "Panel",
      configuration: { instructions: "Three sections." },
    });
    expect(result.ok && result.value.provider).toBeNull();
    expect(normalizeAgentInput({ type: "video_interview", provider: "bolna", name: "x", configuration: { instructions: "y" } }).ok).toBe(false);
  });

  it("refuses the WhatsApp type — it is configured on its own page", () => {
    expect(normalizeAgentInput({ type: "whatsapp_reply", name: "x" }).ok).toBe(false);
  });

  it("refuses unknown and cross-type configuration keys instead of storing them", () => {
    const leaked = normalizeConfiguration("universal", { instructions: "ok", temperature: 0.5 });
    expect(leaked.ok).toBe(false);
    expect(normalizeConfiguration("assessment", { instructions: "ok", objective: "o" }).ok).toBe(false);
  });

  it("bounds custom LLM temperature", () => {
    expect(normalizeConfiguration("custom_llm", { instructions: "x", temperature: 0.4 })).toEqual({
      ok: true,
      value: { instructions: "x", temperature: 0.4 },
    });
    expect(normalizeConfiguration("custom_llm", { instructions: "x", temperature: 2 }).ok).toBe(false);
  });

  it("shows no field for a credential anywhere", () => {
    const keys = Object.values(CONFIG_FIELDS).flat().map((field) => field.key.toLowerCase());
    for (const key of keys) expect(key).not.toMatch(/key|secret|token|password|credential/);
  });
});

describe("usage and the delete guard", () => {
  const agentId = "11111111-1111-4111-8111-111111111111";

  it("counts every automation whose action names the agent", () => {
    expect(
      countAgentUsage(
        [
          { actions: [{ type: "start_screening_call", config: { agent_id: agentId } }] },
          { actions: [{ type: "start_screening_call", config: { agent_id: null } }] },
          { actions: [{ type: "send_templated_message", config: {} }, { type: "x", config: { agent_id: agentId } }] },
          { actions: "not an array" },
        ],
        agentId
      )
    ).toBe(2);
  });

  it("recognises migration 0043's in-use error and nothing else", () => {
    expect(isAgentInUseError({ code: "23503", message: "agent_in_use" })).toBe(true);
    expect(isAgentInUseError({ code: "23503", message: "some other foreign key" })).toBe(false);
    expect(isAgentInUseError(null)).toBe(false);
  });
});

describe("decideDialingAgent — what may telephone a person", () => {
  const credentialAgentId = "credential-agent";

  it("uses a named, active, synced agent", () => {
    expect(
      decideDialingAgent({
        requested: { providerAgentId: "named", status: "active" },
        fallbackDefault: { providerAgentId: "default", status: "active" },
        credentialAgentId,
      })
    ).toEqual({ ok: true, providerAgentId: "named" });
  });

  it("refuses a named agent that is paused, archived or a draft — never substitutes", () => {
    for (const status of ["paused", "archived", "draft"] as const) {
      const decision = decideDialingAgent({
        requested: { providerAgentId: "named", status },
        fallbackDefault: { providerAgentId: "default", status: "active" },
        credentialAgentId,
      });
      expect(decision.ok, status).toBe(false);
    }
  });

  it("refuses when the default is paused or archived", () => {
    for (const status of ["paused", "archived"] as const) {
      expect(
        decideDialingAgent({ requested: null, fallbackDefault: { providerAgentId: "d", status }, credentialAgentId }).ok
      ).toBe(false);
    }
  });

  it("skips a DRAFT default and keeps the calls the organization already places", () => {
    expect(
      decideDialingAgent({ requested: null, fallbackDefault: { providerAgentId: "d", status: "draft" }, credentialAgentId })
    ).toEqual({ ok: true, providerAgentId: credentialAgentId });
  });

  it("behaves exactly as before 0043 when there is no status to read", () => {
    expect(
      decideDialingAgent({
        requested: { providerAgentId: null, status: null },
        fallbackDefault: { providerAgentId: "default", status: null },
        credentialAgentId,
      })
    ).toEqual({ ok: true, providerAgentId: "default" });
    expect(decideDialingAgent({ requested: null, fallbackDefault: null, credentialAgentId })).toEqual({
      ok: true,
      providerAgentId: credentialAgentId,
    });
  });
});
