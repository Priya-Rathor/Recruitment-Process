"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import { HIRING_MODEL_OPTIONS } from "@/lib/organizations/hiringModel";
import { Field } from "../SettingsForm";

const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

/**
 * Organization profile.
 *
 * Posts to TWO endpoints, because the fields live in two tables and neither
 * should be duplicated: name/industry/timezone belong to Module 1's
 * `organizations`, branding belongs to Module 17's `organization_settings`.
 * Copying the timezone into a second table would let the dashboard and the
 * analytics disagree about what "today" is.
 */
export function OrganizationForm({
  organization,
  branding,
}: {
  organization: {
    id: string;
    name: string;
    industry: string | null;
    timezone: string;
    agencyMode: boolean;
  };
  branding: { logo_url: string | null; brand_color: string | null };
}) {
  const router = useRouter();
  const [values, setValues] = useState({ ...organization, ...branding });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof values, value: string | boolean | null) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const [orgResponse, settingsResponse] = await Promise.all([
        fetch(`/api/organizations/${organization.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name,
            industry: values.industry,
            timezone: values.timezone,
            agency_mode: values.agencyMode,
          }),
        }),
        fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            logo_url: values.logo_url || null,
            brand_color: values.brand_color || null,
          }),
        }),
      ]);

      if (!orgResponse.ok) {
        const payload = await orgResponse.json();
        setError(payload.error ?? "Couldn't save the organization profile.");
        return;
      }

      if (!settingsResponse.ok) {
        const payload = await settingsResponse.json();
        // Partial success stated plainly rather than reported as total failure —
        // the profile really did save, and telling someone otherwise makes them
        // enter it again.
        setError(`Profile saved, but branding didn't: ${payload.error ?? "unknown error"}`);
        setDirty(false);
        router.refresh();
        return;
      }

      setDirty(false);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="card mb-4">
        <Field label="Organization name">
          <input
            className="input"
            value={values.name}
            maxLength={120}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>

        <Field label="Industry" hint="Optional.">
          <input
            className="input"
            value={values.industry ?? ""}
            maxLength={120}
            onChange={(event) => set("industry", event.target.value || null)}
          />
        </Field>

        <Field
          label="What do you recruit for?"
          hint="Changing this only shows or hides the client-facing parts of the product. No client, submission or feedback record is ever deleted, so switching back restores everything."
        >
          {HIRING_MODEL_OPTIONS.map((option) => (
            <label
              key={String(option.value)}
              className="radio is-block mb-2"
              style={{ display: "block" }}
            >
              <input
                type="radio"
                name="hiring-model"
                className="mr-2"
                checked={values.agencyMode === option.value}
                onChange={() => set("agencyMode", option.value)}
              />
              {option.label}
              <span
                className="has-text-secondary is-block"
                style={{ fontSize: 12, marginLeft: "1.6rem" }}
              >
                {option.hint}
              </span>
            </label>
          ))}
        </Field>

        <Field
          label="Timezone"
          hint="Every 'today', SLA breach and analytics range in the product is calculated in this timezone — not the server's and not the browser's. Changing it changes what those numbers mean."
        >
          <div className="select is-fullwidth">
            <select
              value={values.timezone}
              onChange={(event) => set("timezone", event.target.value)}
            >
              {/* The current value first, so a timezone set outside this list
                  isn't silently replaced by opening the page. */}
              {!COMMON_TIMEZONES.includes(values.timezone) && (
                <option value={values.timezone}>{values.timezone}</option>
              )}
              {COMMON_TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
        </Field>
      </div>

      <div className="card mb-4">
        <Field label="Logo URL" hint="Must be https. Shown in the app shell.">
          <input
            className="input"
            placeholder="https://…"
            value={values.logo_url ?? ""}
            onChange={(event) => set("logo_url", event.target.value || null)}
          />
        </Field>

        <Field label="Brand colour" hint="Hex, e.g. #004CF5.">
          <input
            className="input"
            style={{ maxWidth: 160 }}
            placeholder="#004CF5"
            value={values.brand_color ?? ""}
            onChange={(event) => set("brand_color", event.target.value || null)}
          />
        </Field>
      </div>

      <FormError message={error} />

      <div className="is-flex is-align-items-center" style={{ gap: "0.75rem" }}>
        <button
          type="button"
          className={`button is-primary ${saving ? "is-loading" : ""}`}
          onClick={save}
          disabled={saving || !dirty || values.name.trim().length === 0}
        >
          Save changes
        </button>
        {dirty && (
          <span className="has-text-secondary" style={{ fontSize: 13 }}>
            Unsaved changes
          </span>
        )}
        {saved && !dirty && (
          <span style={{ fontSize: 13, color: "var(--color-success)" }}>Saved.</span>
        )}
      </div>
    </>
  );
}
