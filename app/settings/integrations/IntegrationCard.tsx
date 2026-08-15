"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { IntegrationHealth } from "@/lib/settings/integrations";
import { formatDateTimeInZone } from "@/lib/time";
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";

/**
 * Integration status, rendered with the shared chip.
 *
 * The colours the spec names for this module (Connected #DCFCE7/#15803D and so
 * on) are the same tokens StatusChip already uses for its tones, so mapping to
 * a tone gives the specified appearance AND one consistent chip geometry across
 * every module — rather than a fourth bespoke chip with its own padding.
 */
function StatusChipFor({ status }: { status: string }) {
  const map: Record<string, { tone: ChipTone; label: string }> = {
    connected: { tone: "success", label: "Connected" },
    needs_attention: { tone: "warning", label: "Needs attention" },
    disconnected: { tone: "neutral", label: "Disconnected" },
    error: { tone: "error", label: "Error" },
  };
  const entry = map[status] ?? map.disconnected;
  return <StatusChip tone={entry.tone} label={entry.label} />;
}

type Dependency = { kind: string; name: string; active: boolean };

export function IntegrationCard({
  integration,
  timeZone,
}: {
  integration: IntegrationHealth;
  /** The ORGANIZATION's timezone, so dates read the same on server and client. */
  timeZone: string;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<"idle" | "connecting" | "confirming_disconnect">("idle");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [dependencyCheckFailed, setDependencyCheckFailed] = useState(false);

  const provider = integration.provider;
  const connected = integration.status === "connected";

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/settings/integrations/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "That didn't work.");
        return false;
      }

      setMode("idle");
      setFields({});
      router.refresh();
      return true;
    } catch {
      setError("Couldn't reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    const ok = await post({ action: "test" });
    if (ok) setNotice("Connection is working.");
  }

  /** Loads what depends on this BEFORE offering to disconnect. */
  async function startDisconnect() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/settings/integrations/${provider}`);
      const payload = await response.json();

      if (response.ok) {
        setDependencies(payload.data.dependencies ?? []);
        setDependencyCheckFailed(Boolean(payload.data.checkFailed));
      } else {
        // Could not check. Say so rather than showing an empty list, which
        // would read as "nothing depends on this".
        setDependencies([]);
        setDependencyCheckFailed(true);
      }

      setMode("confirming_disconnect");
    } catch {
      setDependencies([]);
      setDependencyCheckFailed(true);
      setMode("confirming_disconnect");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/settings/integrations/${provider}?confirm=true`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        const payload = await response.json();
        setError(payload.error ?? "Couldn't disconnect.");
        return;
      }

      setMode("idle");
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: string) => fields[key] ?? "";
  const setField = (key: string, value: string) =>
    setFields((previous) => ({ ...previous, [key]: value }));

  return (
    <div className="card mb-4">
      <div
        className="is-flex is-justify-content-space-between is-align-items-flex-start mb-2"
        style={{ gap: "1rem" }}
      >
        <div style={{ minWidth: 0 }}>
          <h3 className="title is-6 mb-1">{integration.label}</h3>
          <p className="has-text-secondary" style={{ fontSize: 13, margin: 0 }}>
            {integration.description}
          </p>
        </div>
        <StatusChipFor status={integration.status} />
      </div>

      {/* MASKED ONLY. The secret went in once and never comes back out. */}
      {integration.credentialHint && (
        <p className="has-text-secondary" style={{ fontSize: 13, margin: "8px 0 0" }}>
          Credential: <code>{integration.credentialHint}</code>
        </p>
      )}

      {integration.detail && (
        <p className="has-text-secondary" style={{ fontSize: 13, margin: "4px 0 0" }}>
          {integration.detail}
        </p>
      )}

      {integration.lastSuccessAt && (
        <p className="has-text-secondary" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Last worked {formatDateTimeInZone(integration.lastSuccessAt, timeZone)}
        </p>
      )}

      {integration.errorMessage && integration.status !== "connected" && (
        <p style={{ fontSize: 13, margin: "8px 0 0", color: "var(--color-error)" }}>
          {integration.errorMessage}
        </p>
      )}

      {integration.encryptionUnavailable && (
        <p style={{ fontSize: 13, margin: "8px 0 0", color: "var(--color-error)" }}>
          Credential encryption isn&apos;t configured on this server, so nothing can be connected
          until an operator sets it up.
        </p>
      )}

      {integration.serverUnavailable && integration.serverUnavailableReason && (
        <p style={{ fontSize: 13, margin: "8px 0 0", color: "var(--status-attention-text, #B45309)" }}>
          {integration.serverUnavailableReason}
        </p>
      )}

      <FormError message={error} />
      {notice && (
        <p style={{ fontSize: 13, margin: "8px 0 0", color: "var(--color-success)" }}>{notice}</p>
      )}

      {/* ---------------------------------------------------------------- */}
      {mode === "confirming_disconnect" ? (
        <div
          className="mt-4"
          style={{
            border: "1px solid var(--color-warning)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Before disconnecting {integration.label}
          </p>

          {dependencyCheckFailed && (
            <p style={{ fontSize: 13, color: "var(--color-error)", marginBottom: 8 }}>
              We couldn&apos;t check which automations depend on this, so this list may be
              incomplete.
            </p>
          )}

          <ul style={{ fontSize: 13, marginBottom: 12 }}>
            {dependencies.map((dependency, index) => (
              <li key={index} style={{ padding: "2px 0" }}>
                {dependency.kind === "automation" ? (
                  <>
                    <strong>{dependency.name}</strong>
                    <span className="has-text-secondary">
                      {dependency.active ? " — live, will stop working" : " — draft, can't be activated"}
                    </span>
                  </>
                ) : (
                  <span>{dependency.name}</span>
                )}
              </li>
            ))}
          </ul>

          <div className="buttons">
            <button
              type="button"
              className={`button is-small ${busy ? "is-loading" : ""}`}
              style={{ background: "var(--color-error)", color: "#fff", borderColor: "transparent" }}
              onClick={disconnect}
              disabled={busy}
            >
              Disconnect anyway
            </button>
            <button type="button" className="button is-small" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : mode === "connecting" ? (
        <div className="mt-4">
          {provider === "bolna" && (
            <>
              <input
                className="input mb-2"
                type="password"
                placeholder="Bolna API key"
                value={field("apiKey")}
                onChange={(event) => setField("apiKey", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="Agent ID"
                value={field("agentId")}
                onChange={(event) => setField("agentId", event.target.value)}
              />
            </>
          )}

          {provider === "email" && (
            <>
              <input
                className="input mb-2"
                type="password"
                placeholder="Email provider API key"
                value={field("apiKey")}
                onChange={(event) => setField("apiKey", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="From address (e.g. talent@yourcompany.com)"
                value={field("fromAddress")}
                onChange={(event) => setField("fromAddress", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="From name (optional)"
                value={field("fromName")}
                onChange={(event) => setField("fromName", event.target.value)}
              />
            </>
          )}

          {provider === "llm" && (
            <>
              <input
                className="input mb-2"
                type="password"
                placeholder="AI provider API key"
                value={field("apiKey")}
                onChange={(event) => setField("apiKey", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="Model (default gpt-4o-mini)"
                value={field("model")}
                onChange={(event) => setField("model", event.target.value)}
              />
            </>
          )}

          {provider === "n8n" && (
            <>
              <input
                className="input mb-2"
                placeholder="https://your-n8n-instance.example.com"
                value={field("instanceUrl")}
                onChange={(event) => setField("instanceUrl", event.target.value)}
              />
              <input
                className="input mb-2"
                type="password"
                placeholder="n8n API key"
                value={field("apiKey")}
                onChange={(event) => setField("apiKey", event.target.value)}
              />
            </>
          )}

          <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
            The key is encrypted before it&apos;s stored and is never shown again — only the last
            four characters.
          </p>

          <div className="buttons">
            <button
              type="button"
              className={`button is-small is-primary ${busy ? "is-loading" : ""}`}
              onClick={() => post(fields)}
              disabled={busy}
            >
              Save and connect
            </button>
            <button type="button" className="button is-small" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="buttons mt-4">
          {integration.connectStyle === "oauth" ? (
            <button
              type="button"
              className="button is-small is-primary"
              // A FULL page navigation, not client-side routing. The lint rule
              // here suggests router.push(), which is wrong for this case: the
              // endpoint responds with a redirect to accounts.google.com, and
              // Next's router cannot follow a redirect to another origin — it
              // would try to render Google's sign-in page as an app route.
              // Built as an absolute URL to say "leave this app" explicitly.
              onClick={() => {
                window.location.assign(
                  new URL(
                    "/api/settings/integrations/calendar/authorize",
                    window.location.origin
                  ).toString()
                );
              }}
              // Disabled when the deployment has no Google app at all —
              // clicking through to an error is worse than a clear "not yet".
              disabled={integration.serverUnavailable}
            >
              {connected ? "Reconnect" : "Connect"}
            </button>
          ) : (
            <button
              type="button"
              className="button is-small is-primary"
              onClick={() => setMode("connecting")}
              disabled={integration.encryptionUnavailable}
            >
              {connected ? "Replace credentials" : "Connect"}
            </button>
          )}

          {connected && (
            <>
              <button
                type="button"
                className={`button is-small ${busy ? "is-loading" : ""}`}
                onClick={test}
                disabled={busy}
              >
                Test connection
              </button>
              <button
                type="button"
                className={`button is-small ${busy ? "is-loading" : ""}`}
                onClick={startDisconnect}
                disabled={busy}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
