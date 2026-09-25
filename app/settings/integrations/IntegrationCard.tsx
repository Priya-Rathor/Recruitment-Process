"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cloud, SlidersHorizontal } from "lucide-react";
import { FormError } from "@/components/states";
import type { IntegrationHealth } from "@/lib/settings/integrations";
import { formatDateTimeInZone } from "@/lib/time";
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";
import { CredentialDisclosure } from "./CredentialDisclosure";

/**
 * Integration status, rendered with the shared chip.
 *
 * The colours the spec names for this module (Connected var(--status-connected-bg)/var(--status-connected-text) and so
 * on) are the same tokens StatusChip already uses for its tones, so mapping to
 * a tone gives the specified appearance AND one consistent chip geometry across
 * every module — rather than a fourth bespoke chip with its own padding.
 */
function StatusChipFor({
  status,
  platformDefault = false,
}: {
  status: string;
  /** True when the feature works on the platform's key, not one stored here. */
  platformDefault?: boolean;
}) {
  /*
    "USING PLATFORM DEFAULT" IS A PRESENTATION OF `disconnected`, NOT A NEW STATUS.

    The AI provider stores no organization key, so its status genuinely is
    `disconnected` — but resume parsing, matching and drafting are all working, on
    the server's own key. A grey "Disconnected" chip on a working feature is
    simply false, and it sends admins hunting for a fault that is not there.

    Only this chip changes. The status value, the connect flow and every other
    reader are untouched, so an organization can still add its own key and the
    dependency warnings still say what they said.

    Cloud icon rather than a tick: a tick would claim THIS organization connected
    something, which is the one thing that has not happened.
  */
  if (platformDefault) {
    return <StatusChip tone="info" label="Using platform default" icon={Cloud} />;
  }

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

  /*
    THE THREE BUTTON STATES, decided once here rather than at three call sites.

    `blocked` is the state the old markup had no name for: the control was
    rendered as a primary button with `disabled`, which the stylesheet showed as
    the same blue at 55% opacity. Naming it makes it possible to style it as what
    it is — and makes the rule readable: a card is connectable, connected, or
    blocked, never two of those.

    Both blocking conditions are pre-existing logic, unchanged:
      serverUnavailable      — this deployment has no OAuth app (Calendar)
      encryptionUnavailable  — no credential encryption key on this server
  */
  const blocked = integration.serverUnavailable || integration.encryptionUnavailable;
  const blockedReason = integration.serverUnavailable
    ? "This deployment can't connect this integration yet."
    : "Credential encryption isn't configured on this server.";

  const hasMeta = Boolean(
    integration.credentialHint ||
      integration.detail ||
      integration.lastSuccessAt ||
      (integration.errorMessage && !connected) ||
      integration.encryptionUnavailable ||
      (integration.serverUnavailable && integration.serverUnavailableReason)
  );

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
    /*
      The id is the anchor the Settings landing grid deep-links to. Minted from
      the provider key in one place — see INTEGRATION_ANCHOR on the page — so a
      link and its target cannot disagree, and a test asserts every anchor in the
      grid names a provider that still has a card.
    */
    <div className="card integration-card" id={`integration-${provider}`}>
      <div className="integration-card__head">
        <div style={{ minWidth: 0 }}>
          <h3 className="integration-card__title">{integration.label}</h3>
          <p className="integration-card__description">{integration.description}</p>
        </div>
        <StatusChipFor
          status={integration.status}
          platformDefault={integration.platformDefault}
        />
      </div>

      {/*
        EVERY meta line in one block, with one gap.

        Before, each of these six paragraphs carried its own inline margin — 8px,
        4px, 4px, 8px, 8px, 8px — so a card with three of them spaced its content
        differently from a card with one, and the action rows below drifted out of
        alignment for no reason a reader could name. One flex column with one gap
        makes the spacing a property of the group rather than of whichever
        paragraphs happen to be present.
      */}
      {hasMeta && (
        <div className="integration-card__meta">
          {/* MASKED ONLY. The secret went in once and never comes back out. */}
          {integration.credentialHint && (
            <p>
              Credential: <code>{integration.credentialHint}</code>
            </p>
          )}

          {integration.detail && <p>{integration.detail}</p>}

          {integration.lastSuccessAt && (
            <p>Last worked {formatDateTimeInZone(integration.lastSuccessAt, timeZone)}</p>
          )}

          {integration.errorMessage && integration.status !== "connected" && (
            <p className="integration-card__note--error">{integration.errorMessage}</p>
          )}

          {integration.encryptionUnavailable && (
            <p className="integration-card__note--error">
              Credential encryption isn&apos;t configured on this server, so nothing can be
              connected until an operator sets it up.
            </p>
          )}

          {/*
            The OAuth-app-missing explanation. Copy unchanged — it says exactly
            what is wrong and who can fix it. What changed is the BUTTON below it,
            which used to be a half-opacity primary and now reads as disabled.
          */}
          {integration.serverUnavailable && integration.serverUnavailableReason && (
            <p className="integration-card__note--warn">
              {integration.serverUnavailableReason}
            </p>
          )}
        </div>
      )}

      <FormError message={error} />
      {notice && (
        <p style={{ fontSize: 13, margin: "8px 0 0", color: "var(--color-success)" }}>{notice}</p>
      )}

      {/* ---------------------------------------------------------------- */}
      {mode === "confirming_disconnect" ? (
        <div className="integration-card__panel--warning">
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
        <div className="integration-card__panel">
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
                placeholder="Fallback agent ID (optional)"
                aria-label="Fallback Bolna agent ID, optional"
                value={field("agentId")}
                onChange={(event) => setField("agentId", event.target.value)}
              />
              {/*
                ONLY A FALLBACK, and optional since the Agent Center. Calls use
                the voice agent chosen in Settings → Agents and drop back to
                this id only when no agent there has synced. Said here so nobody
                edits this field expecting it to change what the call says.
              */}
              <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
                Leave the agent ID blank if your voice agents are set up in Settings → Agents —
                that is where what the call says, sounds like and does is configured.
              </p>
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


          {provider === "whatsapp" && (
            <>
              <input
                className="input mb-2"
                type="password"
                placeholder="Meta permanent access token"
                value={field("accessToken")}
                onChange={(event) => setField("accessToken", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="Phone number ID (the numeric ID from Meta)"
                value={field("phoneNumberId")}
                onChange={(event) => setField("phoneNumberId", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="Business number as candidates see it (optional)"
                value={field("displayNumber")}
                onChange={(event) => setField("displayNumber", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="Approved WhatsApp template name (optional)"
                value={field("messagingTemplate")}
                onChange={(event) => setField("messagingTemplate", event.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="Template language code (default en)"
                value={field("messagingTemplateLanguage")}
                onChange={(event) => setField("messagingTemplateLanguage", event.target.value)}
              />
              {/*
                The app secret, for INBOUND messages only.

                A password field and optional, because it is only needed when
                this organization brought its own Meta app — a deployment with
                one shared app sets WHATSAPP_APP_SECRET in the environment and
                leaves this blank. Without either, nothing can verify that an
                incoming webhook really came from Meta, so every candidate reply
                is rejected and the inbox stays empty. The inbox says so itself
                rather than leaving it to be discovered.
              */}
              <input
                className="input mb-2"
                type="password"
                placeholder="Meta app secret (optional — for receiving replies)"
                value={field("appSecret")}
                onChange={(event) => setField("appSecret", event.target.value)}
              />
              {/*
                Said here, before connecting, rather than discovered as a failed
                send: Meta only allows free-form text to somebody who messaged the
                business in the last 24 hours. A recruitment pipeline almost never
                is, so without an approved template name most messages will be
                refused by Meta — and the error would look like our bug.
              */}
              <p className="has-text-secondary mb-3" style={{ fontSize: 12 }}>
                WhatsApp only delivers free-form messages to candidates who wrote to you in the
                last 24 hours. To message anyone else, get a message template approved in Meta
                Business Manager and put its name above — your template body is then sent as that
                template&apos;s single parameter. Opt-out follows WhatsApp&apos;s convention: every
                automatic message tells the candidate to reply STOP, and a reply now arrives in
                Messages and sets the opt-out automatically. Receiving replies needs Meta&apos;s
                webhook pointed at this product and an app secret to verify it with — see the
                deployment guide; sending works without either.
              </p>
            </>
          )}

          {/*
            THE FULL DISCLOSURE, AT THE POINT OF ENTRY.

            This was a shortened paraphrase ("the key is encrypted before it's
            stored…"). It said less than the footer note did, in the one place
            where the promise actually matters — with somebody's secret in the
            field above it. Now it is the same component and the same words.
          */}
          <div className="mb-3">
            <CredentialDisclosure placement="inline" />
          </div>

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
        /*
          ONE RULE, NO EXCEPTIONS. Exactly one of the three states renders its
          leading control, and the weight always means the same thing:

            connectable  -> solid primary        "Connect"
            connected    -> outline primary      "Replace credentials"/"Reconnect"
            blocked      -> is-unavailable       "Connect", visibly dead

          The connected case has NO solid button anywhere. There is nothing left
          to urge, so the loudest control on the card would be pointing at an
          action already taken. Module 17's established labels are kept —
          "Replace credentials" says more than "Manage" — they are only demoted
          to outline weight.
        */
        <div className="integration-card__actions">
          {blocked ? (
            <button
              type="button"
              className="button is-small is-unavailable"
              disabled
              // The reason is already spelled out above the row; the title
              // repeats it for anyone who reaches the control before the text.
              title={blockedReason}
            >
              Connect
            </button>
          ) : integration.connectStyle === "oauth" ? (
            <button
              type="button"
              className={`button is-small ${connected ? "is-outlined-primary" : "is-primary"}`}
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
            >
              {connected ? "Reconnect" : "Connect"}
            </button>
          ) : (
            <button
              type="button"
              className={`button is-small ${connected ? "is-outlined-primary" : "is-primary"}`}
              onClick={() => setMode("connecting")}
            >
              {connected ? "Replace credentials" : "Connect"}
            </button>
          )}

          {connected && (
            <>
              <button
                type="button"
                className={`button is-small is-quiet ${busy ? "is-loading" : ""}`}
                onClick={test}
                disabled={busy}
              >
                Test connection
              </button>
              {/*
                Disconnecting stops candidate-facing features, so it carries the
                soft-danger treatment the product already uses for destructive
                actions — not the same neutral grey as "Test connection", which is
                the safest button on the card.
              */}
              <button
                type="button"
                className={`button is-small is-danger-soft ${busy ? "is-loading" : ""}`}
                onClick={startDisconnect}
                disabled={busy}
              >
                Disconnect
              </button>
            </>
          )}

          {/*
            AN INTEGRATION CARD HOLDS THE CONNECTION, NOT THE AGENTS. Voice
            agents used to be configured from a button here; they now live in
            Settings → Agents with every other agent type, and this link is
            only a signpost — nothing about an agent is edited on this card.
            Rendered last so the connect/disconnect actions keep tab order.
          */}
          {provider === "bolna" && (
            <Link className="button is-small is-outlined-primary" href="/settings/agents">
              <SlidersHorizontal size={13} aria-hidden="true" />
              Voice agents are in Agents
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
