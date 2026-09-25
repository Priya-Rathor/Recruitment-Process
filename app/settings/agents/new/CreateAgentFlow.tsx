"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/ui/states";
import {
  AGENT_TYPES,
  AGENT_TYPE_META,
  CHANNEL_LABELS,
  EXTERNALLY_MANAGED,
  type AgentType,
} from "@/lib/agents/types";
import { providersFor, selectableProvidersFor, type ProviderId } from "@/lib/agents/providers";
import type { Connection, Connections } from "@/lib/agents/registry";
import { AgentFields, toConfiguration, type AgentDraft } from "../AgentFields";

const STEPS = ["Agent type", "Provider", "Configure", "Test", "Review & create"] as const;

const EMPTY_DRAFT: AgentDraft = { name: "", description: "", configuration: {} };

export function CreateAgentFlow({ connections }: { connections: Connections }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<AgentType | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  const meta = type ? AGENT_TYPE_META[type] : null;
  const needsProvider = meta?.dependency.kind === "provider";

  const chooseType = (next: AgentType) => {
    setType(next);
    setProvider(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    // The provider step exists only for types that take one.
    setStep(AGENT_TYPE_META[next].dependency.kind === "provider" ? 1 : 2);
  };

  const back = () => {
    setError(null);
    setStep((current) => (current === 2 && !needsProvider ? 0 : current - 1));
  };

  const save = async () => {
    if (!type) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          provider,
          name: draft.name,
          description: draft.description,
          configuration: toConfiguration(type, draft.configuration),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { id: string; name: string };
        error?: string;
      };
      if (!response.ok || !payload.data) {
        setError(payload.error ?? "Couldn't create that agent.");
        return;
      }
      setCreated(payload.data);
      setStep(3);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ol className="agent-steps" aria-label="Create agent steps">
        {STEPS.map((label, index) => {
          // The provider step is part of the flow only when the type takes one.
          if (index === 1 && type && !needsProvider) return null;
          return (
            <li key={label} className="agent-steps__item" aria-current={index === step ? "step" : undefined}>
              <span className="agent-steps__num" aria-hidden="true">
                {index + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {/* Keyed by step so each panel enters with the same short fade. */}
      <div key={step} className="fade-in">
        {step === 0 && <TypeStep selected={type} onChoose={chooseType} />}

        {step === 1 && type && (
          <ProviderStep
            type={type}
            connections={connections}
            selected={provider}
            onChoose={(next) => {
              setProvider(next);
              setStep(2);
            }}
            onBack={back}
            onContinueWithout={() => setStep(2)}
          />
        )}

        {step === 2 && type && (
          <div className="card">
            <h2 className="title is-5 mb-2">Configure {AGENT_TYPE_META[type].label}</h2>
            <Dependency type={type} provider={provider} connections={connections} />

            {EXTERNALLY_MANAGED[type] ? (
              <p className="has-text-secondary" style={{ fontSize: 14 }}>
                Your organization has one WhatsApp Auto Reply Agent: its tone, what it may answer, per-job
                overrides and its kill switch are configured on its own page in Agents, so there is only
                ever one place to switch it off. It uses the WhatsApp Business connection above.
              </p>
            ) : (
              <>
                {!AGENT_TYPE_META[type].runnable && (
                  <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
                    This agent will be saved as a draft. {AGENT_TYPE_META[type].blockedReason}
                  </p>
                )}
                <AgentFields type={type} draft={draft} onChange={setDraft} />
                <FormError message={error} />
              </>
            )}

            <div className="is-flex is-justify-content-space-between mt-4" style={{ gap: 8, flexWrap: "wrap" }}>
              <Button variant="ghost" icon={ArrowLeft} onClick={back}>
                Back
              </Button>
              {EXTERNALLY_MANAGED[type] ? (
                <Link className="button is-primary" href={EXTERNALLY_MANAGED[type].href}>
                  Configure WhatsApp Auto Reply Agent
                </Link>
              ) : (
                <Button variant="primary" loading={saving} onClick={save} disabled={!draft.name.trim()}>
                  Save as draft
                </Button>
              )}
            </div>
          </div>
        )}

        {step >= 3 && created && type && <NextSteps agent={created} type={type} />}
      </div>
    </>
  );
}

function TypeStep({ selected, onChoose }: { selected: AgentType | null; onChoose: (type: AgentType) => void }) {
  return (
    <ul className="agent-types" aria-label="Agent types">
      {AGENT_TYPES.map((type, index) => {
        const meta = AGENT_TYPE_META[type];
        const Icon = meta.icon;
        return (
          <li key={type}>
            <button
              type="button"
              className="agent-type"
              style={{ ["--i" as string]: index }}
              aria-pressed={selected === type}
              onClick={() => onChoose(type)}
            >
              <span className="agent-type__icon" aria-hidden="true">
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <span className="agent-type__name">{meta.label}</span>
              <span className="agent-type__purpose">{meta.purpose}</span>
              <span className="agent-type__note">
                {meta.dependency.kind === "provider"
                  ? "Choose a provider next"
                  : meta.dependency.kind === "channel"
                    ? `Uses your ${CHANNEL_LABELS[meta.dependency.integration]} connection`
                    : "Runs on the platform AI provider"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ProviderStep({
  type,
  connections,
  selected,
  onChoose,
  onBack,
  onContinueWithout,
}: {
  type: AgentType;
  connections: Connections;
  selected: ProviderId | null;
  onChoose: (provider: ProviderId) => void;
  onBack: () => void;
  onContinueWithout: () => void;
}) {
  const providers = selectableProvidersFor(type);
  // Documented by the provider but with no adapter in Scoreboad: named in one
  // line, not offered as a choice.
  const notYet = providersFor(type).filter((provider) => provider.adapter !== "built");

  return (
    <div className="card">
      <h2 className="title is-5 mb-2">Choose a provider</h2>

      {providers.length === 0 ? (
        <>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            No provider for this agent is available in Scoreboad yet.
          </p>
          <div className="is-flex is-justify-content-space-between" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
              Back
            </Button>
            <Button variant="outline" icon={ArrowRight} onClick={onContinueWithout}>
              Continue as a draft
            </Button>
          </div>
        </>
      ) : (
        <>
          <ul className="agent-types agent-types--providers mb-3" aria-label="Providers">
            {providers.map((provider, index) => (
              <li key={provider.id}>
                <button
                  type="button"
                  className="agent-type"
                  style={{ ["--i" as string]: index }}
                  aria-pressed={selected === provider.id}
                  onClick={() => onChoose(provider.id)}
                >
                  <span className="agent-type__name">{provider.label}</span>
                  <ConnectionChip connection={connections.providers[provider.id]} />
                  <span className="agent-type__purpose">
                    {provider.capabilities.find((capability) => capability.type === type)?.evidence}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {notYet.length > 0 && (
            <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
              {notYet.map((provider) => provider.label).join(", ")}: not available in Scoreboad yet.
            </p>
          )}
          <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
        </>
      )}
    </div>
  );
}

export function ConnectionChip({ connection }: { connection: Connection }) {
  if (connection.state === "connected") return <StatusChip tone="success" label="Connected" />;
  if (connection.state === "needs_attention") return <StatusChip tone="warning" label="Needs attention" />;
  if (connection.state === "unavailable") return <StatusChip tone="neutral" label="Not available" />;
  return <StatusChip tone="neutral" label="Not connected" />;
}

/** What this agent depends on, and whether it is there — stated before the form. */
function Dependency({
  type,
  provider,
  connections,
}: {
  type: AgentType;
  provider: ProviderId | null;
  connections: Connections;
}) {
  const dependency = AGENT_TYPE_META[type].dependency;

  let label: string;
  let connection: Connection | null = null;
  if (dependency.kind === "provider") {
    if (!provider) return null;
    label = provider === "bolna" ? "Bolna" : "Sarvam";
    connection = connections.providers[provider];
  } else if (dependency.kind === "channel") {
    label = CHANNEL_LABELS[dependency.integration];
    connection = connections.channels[dependency.integration];
  } else {
    label = "AI provider";
    connection = { state: connections.ai.configured ? "connected" : "not_connected", manageHref: null };
  }

  return (
    <div className="is-flex is-align-items-center mb-4" style={{ gap: 10, flexWrap: "wrap", fontSize: 14 }}>
      <span>{label}</span>
      <ConnectionChip connection={connection} />
      {connection.manageHref && (
        <Link href={connection.manageHref} className="has-text-link" style={{ fontSize: 13 }}>
          {connection.state === "connected" ? "Manage connection" : `Connect ${label}`}
        </Link>
      )}
      {dependency.kind === "none" && !connections.ai.configured && (
        <span className="has-text-secondary" style={{ fontSize: 13 }}>
          The platform AI provider isn&apos;t configured on this server.
        </span>
      )}
    </div>
  );
}

/** Steps 4 and 5 — honest about what exists. No simulated test result. */
function NextSteps({ agent, type }: { agent: { id: string; name: string }; type: AgentType }) {
  return (
    <div className="card">
      <h2 className="title is-5 mb-2">{agent.name} is saved as a draft</h2>
      <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
        Nothing runs a draft. Testing and a review before activation are coming next in the Agent
        Center.
        {type === "voice_screening" &&
          " Until then, the voice console can already place a real test call to your own phone."}
      </p>
      <div className="is-flex" style={{ gap: 8, flexWrap: "wrap" }}>
        {type === "voice_screening" && (
          <Link className="button is-primary" href={`/settings/agents/voice?agent=${agent.id}`}>
            <ExternalLink size={16} aria-hidden="true" />
            <span>Test in the voice console</span>
          </Link>
        )}
        <Link className="button is-outlined-primary" href="/settings/agents">
          Back to agents
        </Link>
      </div>
    </div>
  );
}
