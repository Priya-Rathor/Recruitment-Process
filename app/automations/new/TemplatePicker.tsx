"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import { ACTION_LABELS, TRIGGER_LABELS, describeRule } from "@/lib/automations/catalog";
import type { RuleTemplate } from "@/lib/automations/templates";

/**
 * "Start from a template."
 *
 * A blank builder asks somebody to invent a rule out of a vocabulary they have
 * not read. These are the eight starting points, and each card says what the
 * template deliberately does NOT do — because the omissions are the part that
 * makes a template safe to hand to someone, and the part nobody would guess.
 *
 * Picking one POSTs the template's ID, not its rule: the server reads the
 * definition itself. Otherwise "template" would be a second, unvalidated way to
 * post a rule body.
 *
 * It creates a DRAFT, like every other path. There is no click here that makes
 * something live.
 */
export function TemplatePicker({
  templates,
  disconnected,
}: {
  templates: RuleTemplate[];
  /** Integrations this organization does not have connected. */
  disconnected: string[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function create(template: RuleTemplate) {
    setCreating(template.id);
    setError(null);

    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: template.id }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Couldn't create that automation.");
        return;
      }

      router.push(`/automations/${payload.data.id}`);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="card mb-4">
      <div
        className="is-flex is-justify-content-space-between is-align-items-center"
        style={{ gap: "1rem", flexWrap: "wrap" }}
      >
        <div>
          <h2 className="title is-5 mb-1">Start from a template</h2>
          <p className="has-text-secondary mb-0" style={{ fontSize: 13 }}>
            Eight rules most teams want, already built. Each one arrives as a draft you can edit.
          </p>
        </div>
        <button type="button" className="button is-small" onClick={() => setOpen(!open)}>
          {open ? "Hide templates" : "Show templates"}
        </button>
      </div>

      <FormError message={error} />

      {open && (
        <div className="mt-4">
          {templates.map((template) => {
            const missing = template.needs.filter((need) => disconnected.includes(need));

            return (
              <div
                key={template.id}
                className="mb-3"
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  padding: "1rem",
                }}
              >
                <p style={{ fontSize: 15, fontWeight: 600 }}>{template.name}</p>
                <p className="mt-1" style={{ fontSize: 14 }}>
                  {template.summary}
                </p>
                <p className="has-text-secondary mt-2" style={{ fontSize: 13 }}>
                  {template.note}
                </p>

                <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
                  When: {TRIGGER_LABELS[template.trigger]} · Then:{" "}
                  {template.actions.map((action) => ACTION_LABELS[action.type]).join(", ")}
                  {template.requiresApproval ? " · needs approval" : ""}
                  {template.dailyRunCap ? ` · max ${template.dailyRunCap}/day` : ""}
                </p>

                {/* Stated before the click, not discovered at activation. The
                    template can still be saved as a draft — an admin may be about
                    to connect the integration. */}
                {missing.length > 0 && (
                  <p className="mt-2" style={{ fontSize: 13, color: "var(--color-warning)" }}>
                    Needs {missing.join(" and ")} connected before it can be activated. You can
                    still save it as a draft.
                  </p>
                )}

                <details className="mt-2">
                  <summary className="has-text-secondary" style={{ fontSize: 13, cursor: "pointer" }}>
                    Read the exact rule
                  </summary>
                  <p className="mt-2" style={{ fontSize: 13 }}>
                    {describeRule({
                      trigger: template.trigger,
                      conditions: template.conditions,
                      actions: template.actions,
                    })}
                  </p>
                </details>

                <button
                  type="button"
                  className={`button is-small mt-3 ${creating === template.id ? "is-loading" : ""}`}
                  onClick={() => create(template)}
                  disabled={creating !== null}
                >
                  Use this as a draft
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
