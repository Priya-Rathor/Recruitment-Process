"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { PreferenceView } from "@/lib/notifications/queries";

type Scope = "user" | "organization";

/**
 * Notification settings.
 *
 * Two scopes on one screen, deliberately. Keeping them apart would hide the
 * thing people actually need to see: whether a setting is theirs or inherited.
 * The "Following the team default" line is the whole point — without it, a
 * personal override looks identical to an org-wide one, and an admin changing
 * the default has no idea whose settings will move.
 *
 * Explicit Save per row rather than auto-save on toggle, per the design system.
 */
export function PreferenceEditor({
  preferences,
  canEditOrganization,
}: {
  preferences: PreferenceView[];
  canEditOrganization: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("user");
  const [pending, setPending] = useState<Record<string, { inApp: boolean; email: boolean }>>({});
  const [savingType, setSavingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function current(preference: PreferenceView) {
    const draft = pending[preference.type];
    if (draft) return draft;

    return scope === "organization"
      ? { inApp: preference.organizationDefault.inApp, email: preference.organizationDefault.email }
      : { inApp: preference.effective.inApp, email: preference.effective.email };
  }

  function change(type: string, patch: Partial<{ inApp: boolean; email: boolean }>) {
    const preference = preferences.find((entry) => entry.type === type);
    if (!preference) return;

    setPending((previous) => ({
      ...previous,
      [type]: { ...current(preference), ...patch },
    }));
  }

  async function save(preference: PreferenceView) {
    const draft = pending[preference.type];
    if (!draft) return;

    setSavingType(preference.type);
    setError(null);

    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: preference.type,
          scope,
          in_app_enabled: draft.inApp,
          email_enabled: draft.email,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        setError(payload.error ?? "Couldn't save that setting.");
        return;
      }

      setPending((previous) => {
        const next = { ...previous };
        delete next[preference.type];
        return next;
      });
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSavingType(null);
    }
  }

  async function reset(preference: PreferenceView) {
    setSavingType(preference.type);
    setError(null);

    try {
      const response = await fetch(
        `/api/notifications/preferences?type=${preference.type}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        setError("Couldn't reset that setting.");
        return;
      }
      setPending((previous) => {
        const next = { ...previous };
        delete next[preference.type];
        return next;
      });
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSavingType(null);
    }
  }

  return (
    <>
      {canEditOrganization && (
        <div className="card mb-4">
          <div className="buttons mb-2">
            <button
              type="button"
              className={`button is-small ${scope === "user" ? "is-primary" : ""}`}
              onClick={() => {
                setScope("user");
                setPending({});
              }}
            >
              My settings
            </button>
            <button
              type="button"
              className={`button is-small ${scope === "organization" ? "is-primary" : ""}`}
              onClick={() => {
                setScope("organization");
                setPending({});
              }}
            >
              Team defaults
            </button>
          </div>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {scope === "organization"
              ? "Team defaults apply to everyone who hasn't chosen their own. Changing one won't override a colleague's personal choice."
              : "Your own settings. These override the team default."}
          </p>
        </div>
      )}

      <FormError message={error} />

      <div className="card">
        {preferences.map((preference, index) => {
          const value = current(preference);
          const dirty = Boolean(pending[preference.type]);
          const saving = savingType === preference.type;

          return (
            <div
              key={preference.type}
              style={{
                borderTop: index === 0 ? "none" : "1px solid var(--color-border)",
                padding: index === 0 ? "0 0 16px" : "16px 0",
              }}
            >
              <div className="is-flex is-justify-content-space-between" style={{ gap: "1rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                    {preference.label}
                    {preference.audience === "external" && (
                      <span
                        className="ml-2"
                        style={{ fontSize: 12, fontWeight: 400, color: "var(--color-info, var(--color-info))" }}
                      >
                        goes to a candidate
                      </span>
                    )}
                  </p>
                  <p className="has-text-secondary" style={{ fontSize: 13, margin: "2px 0 0" }}>
                    {preference.description}
                  </p>

                  {/* The line that makes the two scopes legible. */}
                  {scope === "user" && preference.effective.source !== "user" && (
                    <p
                      className="has-text-secondary"
                      style={{ fontSize: 12, margin: "4px 0 0", fontStyle: "italic" }}
                    >
                      Following the{" "}
                      {preference.effective.source === "organization" ? "team" : "built-in"} default
                    </p>
                  )}
                </div>

                <div style={{ flexShrink: 0 }}>
                  <label className="is-block mb-1" style={{ fontSize: 13 }}>
                    <input
                      type="checkbox"
                      className="mr-2"
                      checked={value.inApp}
                      disabled={preference.inAppMandatory}
                      onChange={(event) =>
                        change(preference.type, { inApp: event.target.checked })
                      }
                    />
                    In app
                  </label>
                  <label className="is-block" style={{ fontSize: 13 }}>
                    <input
                      type="checkbox"
                      className="mr-2"
                      checked={value.email}
                      onChange={(event) =>
                        change(preference.type, { email: event.target.checked })
                      }
                    />
                    Email
                  </label>
                </div>
              </div>

              {preference.inAppMandatory && (
                <p className="has-text-secondary" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  In-app can&apos;t be turned off — it&apos;s how the team finds out something needs
                  a person.
                </p>
              )}

              {(dirty || (scope === "user" && preference.effective.source === "user")) && (
                <div className="buttons mt-2">
                  {dirty && (
                    <button
                      type="button"
                      className={`button is-small is-primary ${saving ? "is-loading" : ""}`}
                      onClick={() => save(preference)}
                      disabled={saving}
                    >
                      Save
                    </button>
                  )}
                  {scope === "user" && preference.effective.source === "user" && (
                    <button
                      type="button"
                      className="button is-small"
                      onClick={() => reset(preference)}
                      disabled={saving}
                    >
                      Use the team default
                    </button>
                  )}
                  {dirty && (
                    <span
                      className="has-text-secondary"
                      style={{ fontSize: 13, alignSelf: "center" }}
                    >
                      Unsaved
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
