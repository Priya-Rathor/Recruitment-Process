"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/states";
import { AGENT_TYPE_META } from "@/lib/agents/types";
import type { Agent } from "@/lib/agents/queries";
import { AgentFields, toConfiguration, type AgentDraft } from "../AgentFields";

/** Explicit Save, never auto-save (AGENTS.md). Status changes live on the list's menu. */
export function AgentEditor({ agent }: { agent: Agent }) {
  const router = useRouter();
  const isVoice = agent.type === "voice_screening";
  const [draft, setDraft] = useState<AgentDraft>({
    name: agent.name,
    description: agent.description ?? "",
    configuration: Object.fromEntries(
      Object.entries(agent.configuration).map(([key, value]) => [key, String(value)])
    ),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/settings/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          ...(isVoice ? {} : { configuration: toConfiguration(agent.type, draft.configuration) }),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "Couldn't save that agent.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  const meta = AGENT_TYPE_META[agent.type];

  return (
    <div className="card">
      {!meta.runnable && (
        <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
          {meta.blockedReason}
        </p>
      )}
      <AgentFields type={agent.type} draft={draft} onChange={setDraft} showConfiguration={!isVoice} />
      <FormError message={error} />
      <div className="is-flex is-align-items-center mt-4" style={{ gap: 12 }}>
        <Button variant="primary" loading={saving} onClick={save} disabled={!draft.name.trim()}>
          Save
        </Button>
        {saved && (
          <span role="status" className="has-text-secondary" style={{ fontSize: 13 }}>
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
