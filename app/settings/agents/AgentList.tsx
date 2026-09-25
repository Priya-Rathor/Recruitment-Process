"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/ui/states";
import { AGENT_TYPE_META, STATUS_META, allowedStatuses, type AgentStatus } from "@/lib/agents/types";
import { PROVIDERS } from "@/lib/agents/providers";
import type { AgentListItem } from "@/lib/agents/queries";
import type { ConnectionState } from "@/lib/agents/registry";

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function AgentList({
  agents,
  canManage,
  providerStates,
}: {
  agents: AgentListItem[];
  canManage: boolean;
  providerStates: Record<string, ConnectionState>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const act = async (agent: AgentListItem, request: { method: "PATCH" | "DELETE"; status?: AgentStatus }) => {
    if (request.method === "DELETE" && !window.confirm(`Delete ${agent.name}? This can't be undone.`)) return;

    setBusy(agent.id);
    setErrors((current) => ({ ...current, [agent.id]: "" }));
    try {
      const response = await fetch(`/api/settings/agents/${agent.id}`, {
        method: request.method,
        headers: request.status ? { "Content-Type": "application/json" } : undefined,
        body: request.status ? JSON.stringify({ status: request.status }) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setErrors((current) => ({ ...current, [agent.id]: payload.error ?? "That didn't work. Try again." }));
        return;
      }
      router.refresh();
    } catch {
      setErrors((current) => ({ ...current, [agent.id]: "Couldn't reach the server. Nothing changed." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="agent-list" aria-label="Agents">
      {agents.map((agent, index) => {
        const meta = AGENT_TYPE_META[agent.type];
        const Icon = meta.icon;
        const status = STATUS_META[agent.status];
        const external = agent.type === "whatsapp_reply";
        const statuses = allowedStatuses(agent.type).filter((next) => next !== agent.status);
        const editHref = agent.manageHref ?? `/settings/agents/${agent.id}`;

        return (
          <li key={`${agent.type}-${agent.id}`} className="card agent-row" style={{ ["--i" as string]: index }}>
            <span className="agent-type__icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.75} />
            </span>

            <div style={{ minWidth: 0 }}>
              <p className="agent-row__name">{agent.name}</p>
              <p className="agent-row__type">
                {meta.label}
                {agent.provider && (
                  <>
                    {" · "}
                    {PROVIDERS[agent.provider].label}
                    {providerStates[agent.provider] !== "connected" && " (not connected)"}
                  </>
                )}
                {agent.isDefaultVoice && " · Default for screening calls"}
              </p>
            </div>

            <div className="agent-row__meta">
              <span>
                {agent.usedBy.length === 0
                  ? external
                    ? "Replies to inbound WhatsApp messages"
                    : "Not used by any workflow"
                  : `Used by ${agent.usedBy.slice(0, 2).join(", ")}${
                      agent.usedBy.length > 2 ? ` and ${agent.usedBy.length - 2} more` : ""
                    }`}
              </span>
              <span>Updated {DATE.format(new Date(agent.updatedAt))}</span>
            </div>

            <div className="agent-row__actions">
              <StatusChip tone={status.tone} label={status.label} />
              {canManage && (
                <details className="agent-menu">
                  <summary className="button is-small is-ghost" aria-label={`Actions for ${agent.name}`}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </summary>
                  <div className="agent-menu__panel">
                    <Link href={editHref}>{external || agent.type === "voice_screening" ? "Manage" : "Edit"}</Link>
                    {/* The WhatsApp agent's switches live on its own page, beside its kill switch. */}
                    {!external &&
                      statuses.map((next) => (
                        <button
                          key={next}
                          type="button"
                          disabled={busy === agent.id}
                          onClick={() => act(agent, { method: "PATCH", status: next })}
                        >
                          {next === "active"
                            ? "Activate"
                            : next === "paused"
                              ? "Pause"
                              : next === "archived"
                                ? "Archive"
                                : "Move to draft"}
                        </button>
                      ))}
                    {!external && (
                      <button
                        type="button"
                        className="is-danger"
                        disabled={busy === agent.id}
                        onClick={() => act(agent, { method: "DELETE" })}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </details>
              )}
            </div>

            {errors[agent.id] && (
              <div style={{ gridColumn: "1 / -1" }}>
                <FormError message={errors[agent.id]} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
