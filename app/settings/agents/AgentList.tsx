"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Search } from "lucide-react";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/ui/states";
import {
  AGENT_TYPE_META,
  STATUS_META,
  allowedStatuses,
  type AgentStatus,
  type AgentType,
} from "@/lib/agents/types";
import { PROVIDERS } from "@/lib/agents/providers";
import type { AgentListItem } from "@/lib/agents/queries";
import type { ConnectionState } from "@/lib/agents/registry";

const DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const STATUS_FILTERS = ["all", "active", "draft", "paused"] as const;

/** Broad groups for the type filter — nine types is too many chips. */
const TYPE_GROUPS: { label: string; types: AgentType[] }[] = [
  { label: "Voice", types: ["voice_screening", "voice_interview"] },
  { label: "Video", types: ["video_interview"] },
  { label: "Screening", types: ["cv_screening"] },
  { label: "Communication", types: ["whatsapp_reply", "email_reply"] },
  { label: "Assessment", types: ["assessment"] },
  { label: "Custom", types: ["universal", "custom_llm"] },
];

/**
 * Who executes it, in one label. A provider type names its provider; a
 * channel type names the integration it runs on; everything else runs on the
 * platform's own AI provider.
 */
function executorLabel(
  agent: AgentListItem,
  providerStates: Record<string, ConnectionState>,
): string {
  if (agent.provider) {
    const connected = providerStates[agent.provider] === "connected";
    return `${PROVIDERS[agent.provider].label}${connected ? "" : " (not connected)"}`;
  }
  const dependency = AGENT_TYPE_META[agent.type].dependency;
  if (dependency.kind === "channel")
    return dependency.integration === "whatsapp"
      ? "WhatsApp Business"
      : "Email";
  if (dependency.kind === "provider") return "No provider available yet";
  return "Scoreboad AI";
}

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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]>("all");
  const [group, setGroup] = useState<string>("all");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groupTypes = TYPE_GROUPS.find(
      (entry) => entry.label === group,
    )?.types;
    return agents.filter(
      (agent) =>
        (!needle || agent.name.toLowerCase().includes(needle)) &&
        (statusFilter === "all" || agent.status === statusFilter) &&
        (!groupTypes || groupTypes.includes(agent.type)),
    );
  }, [agents, query, statusFilter, group]);

  // Only offer the type groups that have agents in them.
  const groups = TYPE_GROUPS.filter((entry) =>
    agents.some((agent) => entry.types.includes(agent.type)),
  );

  const act = async (
    agent: AgentListItem,
    request: { method: "PATCH" | "DELETE"; status?: AgentStatus },
  ) => {
    if (
      request.method === "DELETE" &&
      !window.confirm(`Delete ${agent.name}? This can't be undone.`)
    )
      return;

    setBusy(agent.id);
    setErrors((current) => ({ ...current, [agent.id]: "" }));
    try {
      const response = await fetch(`/api/settings/agents/${agent.id}`, {
        method: request.method,
        headers: request.status
          ? { "Content-Type": "application/json" }
          : undefined,
        body: request.status
          ? JSON.stringify({ status: request.status })
          : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setErrors((current) => ({
          ...current,
          [agent.id]: payload.error ?? "That didn't work. Try again.",
        }));
        return;
      }
      router.refresh();
    } catch {
      setErrors((current) => ({
        ...current,
        [agent.id]: "Couldn't reach the server. Nothing changed.",
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="agent-toolbar" role="search">
        <label className="agent-toolbar__search">
          <Search size={16} aria-hidden="true" />
          <input
            className="input"
            type="search"
            placeholder="Search agents..."
            aria-label="Search agents by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="agent-toolbar__filters">
          <select
            className="input"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as (typeof STATUS_FILTERS)[number],
              )
            }
          >
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === "all" ? "All statuses" : STATUS_META[status].label}
              </option>
            ))}
          </select>
          {groups.length > 1 && (
            <select
              className="input"
              aria-label="Filter by agent type"
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="all">All types</option>
              {groups.map((entry) => (
                <option key={entry.label} value={entry.label}>
                  {entry.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <p
        className="has-text-secondary mb-3"
        role="status"
        style={{ fontSize: 13 }}
      >
        {visible.length === agents.length
          ? `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`
          : `${visible.length} of ${agents.length} agents`}
      </p>

      {visible.length === 0 && (
        <div className="card">
          <p className="has-text-secondary" style={{ fontSize: 14 }}>
            No agents match. Clear the search or filters to see all{" "}
            {agents.length}.
          </p>
        </div>
      )}

      <ul className="agent-list" aria-label="Agents">
        {visible.map((agent, index) => {
          const meta = AGENT_TYPE_META[agent.type];
          const Icon = meta.icon;
          const status = STATUS_META[agent.status];
          const external = agent.type === "whatsapp_reply";
          const statuses = allowedStatuses(agent.type).filter(
            (next) => next !== agent.status,
          );
          const editHref = agent.manageHref ?? `/settings/agents/${agent.id}`;

          return (
            <li
              key={`${agent.type}-${agent.id}`}
              className="card agent-row"
              style={{ ["--i" as string]: index }}
            >
              <span className="agent-type__icon" aria-hidden="true">
                <Icon size={20} strokeWidth={1.75} />
              </span>

              <div style={{ minWidth: 0 }}>
                <p className="agent-row__name">{agent.name}</p>
                <p className="agent-row__type">
                  {meta.label}
                  {agent.isDefaultVoice && " · Default for screening calls"}
                </p>
                <p className="agent-row__type">
                  Provider: {executorLabel(agent, providerStates)}
                </p>
              </div>

              <div className="agent-row__meta">
                <span>
                  {agent.usedBy.length === 0
                    ? external
                      ? "Used in: candidate WhatsApp conversations"
                      : "Used in: not assigned"
                    : `Used in: ${agent.usedBy.slice(0, 2).join(", ")}${
                        agent.usedBy.length > 2
                          ? ` and ${agent.usedBy.length - 2} more`
                          : ""
                      }`}
                </span>
                <span>Updated {DATE.format(new Date(agent.updatedAt))}</span>
              </div>

              <div className="agent-row__actions">
                <StatusChip tone={status.tone} label={status.label} />
                {canManage && (
                  <details className="agent-menu">
                    <summary
                      className="button is-small is-ghost"
                      aria-label={`Actions for ${agent.name}`}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </summary>
                    <div className="agent-menu__panel">
                      <Link href={editHref}>
                        {external || agent.type === "voice_screening"
                          ? "Manage"
                          : "Edit"}
                      </Link>
                      {/* The WhatsApp agent's switches live on its own page, beside its kill switch. */}
                      {!external &&
                        statuses.map((next) => (
                          <button
                            key={next}
                            type="button"
                            disabled={busy === agent.id}
                            onClick={() =>
                              act(agent, { method: "PATCH", status: next })
                            }
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
    </>
  );
}
