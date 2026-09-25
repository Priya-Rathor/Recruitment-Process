import { describe, expect, it, vi } from "vitest";

// The adapters' real getStatus() never returns a key — but this test does not
// rely on that. Each mock returns everything a status object could plausibly
// carry, including a secret-shaped field, and the registry must forward none of it.
const leaky = {
  status: "connected",
  credentialHint: "sk-…9f2c",
  apiKey: "sk-live-SHOULD-NEVER-LEAVE",
  settings: { agentId: "provider-agent-id" },
};

vi.mock("@/lib/integrations/bolna", () => ({ getStatus: vi.fn(async () => leaky) }));
vi.mock("@/lib/integrations/email", () => ({ getStatus: vi.fn(async () => ({ ...leaky, status: "disconnected" })) }));
vi.mock("@/lib/integrations/whatsapp", () => ({
  getStatus: vi.fn(async () => {
    throw new Error("read failed");
  }),
}));
vi.mock("@/lib/ai/provider", () => ({ isAiConfigured: () => false }));

describe("loadConnections — connection state, and nothing else", () => {
  it("forwards only states and links, never a credential or provider id", async () => {
    const { loadConnections } = await import("./registry");
    const connections = await loadConnections("org-1");
    const serialised = JSON.stringify(connections);

    expect(serialised).not.toContain("SHOULD-NEVER-LEAVE");
    expect(serialised).not.toContain("sk-");
    expect(serialised).not.toContain("provider-agent-id");

    for (const connection of [
      ...Object.values(connections.providers),
      connections.channels.whatsapp,
      connections.channels.email,
    ]) {
      expect(Object.keys(connection).sort()).toEqual(["manageHref", "state"]);
    }
  });

  it("reports honest states: connected, not connected, a failed read as needs-attention, no adapter as unavailable", async () => {
    const { loadConnections } = await import("./registry");
    const connections = await loadConnections("org-1");

    expect(connections.providers.bolna.state).toBe("connected");
    expect(connections.channels.email.state).toBe("not_connected");
    // A read that failed is never shown as connected — or as simply "off".
    expect(connections.channels.whatsapp.state).toBe("needs_attention");
    // No adapter means no Connect button to a flow that doesn't exist.
    expect(connections.providers.sarvam).toEqual({ state: "unavailable", manageHref: null });
    expect(connections.ai.configured).toBe(false);
  });
});
