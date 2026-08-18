"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { Organization } from "@/lib/types";
import { HIRING_MODEL_OPTIONS, isAgencyMode } from "@/lib/organizations/hiringModel";
import type { OnboardingRecommendations } from "@/lib/ai/generateOnboardingRecommendations";

const TEAM_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"];
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
];

type Step = "organization" | "focus" | "review";

export function OnboardingFlow({
  existingOrganization,
  canUseAi,
}: {
  existingOrganization: Organization | null;
  canUseAi: boolean;
}) {
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(existingOrganization);
  const [step, setStep] = useState<Step>(existingOrganization ? "focus" : "organization");

  // Step 1 fields
  const [name, setName] = useState(existingOrganization?.name ?? "");
  const [country, setCountry] = useState(existingOrganization?.country ?? "India");
  const [timezone, setTimezone] = useState(existingOrganization?.timezone ?? "Asia/Kolkata");

  // Step 2 fields
  const [industry, setIndustry] = useState(existingOrganization?.industry ?? "");
  /**
   * Agency or in-house. Asked here because it decides which product the user
   * sees from their very first page, and because the honest default for a new
   * workspace is "we don't know yet" rather than the column default.
   */
  const [agencyMode, setAgencyMode] = useState(
    isAgencyMode(existingOrganization)
  );
  const [size, setSize] = useState(existingOrganization?.size ?? TEAM_SIZES[0]);
  const [hiringFocus, setHiringFocus] = useState(existingOrganization?.onboarding_answer ?? "");

  const [suggestions, setSuggestions] = useState<OnboardingRecommendations | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, country, timezone }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? "Could not create your workspace. Please try again.");
      setBusy(false);
      return;
    }

    setOrganization(payload.data as Organization);
    setStep("focus");
    setBusy(false);
    // Refresh so the shell/middleware see the new membership.
    router.refresh();
  }

  /**
   * Asks the AI Service Layer for starting defaults. Nothing is saved here —
   * the suggestions are rendered for review and the Owner explicitly accepts
   * or skips them on the next step.
   */
  async function generateSuggestions() {
    if (!organization) return;
    setBusy(true);
    setAiError(null);
    setError(null);

    const response = await fetch(`/api/organizations/${organization.id}/ai-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hiringFocus }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      // AI failure must never block onboarding — surface it and let them skip.
      setAiError(
        payload?.error ?? "We couldn't generate suggestions. You can continue without them."
      );
      setSuggestions(null);
      setStep("review");
      setBusy(false);
      return;
    }

    setSuggestions(payload.data as OnboardingRecommendations);
    setStep("review");
    setBusy(false);
  }

  /** Saves the questionnaire answers and finishes onboarding. */
  async function finish() {
    if (!organization) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/organizations/${organization.id}/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ industry, size, hiringFocus, agency_mode: agencyMode }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save your answers. Please try again.");
      setBusy(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="card">
      <p className="has-text-secondary mb-2" style={{ fontSize: 13 }}>
        Step {step === "organization" ? 1 : step === "focus" ? 2 : 3} of 3
      </p>

      {step === "organization" && (
        <form onSubmit={createOrganization}>
          <h1 className="title is-4">Name your workspace</h1>
          <p className="subtitle is-6 has-text-secondary">
            This is the organization every job, candidate, and client will belong to.
          </p>

          <FormError message={error} />

          <div className="field">
            <label className="label" htmlFor="org-name">
              Organization name
            </label>
            <div className="control">
              <input
                id="org-name"
                className="input"
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="country">
              Country
            </label>
            <div className="control">
              <input
                id="country"
                className="input"
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="timezone">
              Timezone
            </label>
            <div className="control">
              <div className="select is-fullwidth">
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="help has-text-secondary">
              Used for every &ldquo;today&rdquo; and &ldquo;this week&rdquo; calculation across the
              product.
            </p>
          </div>

          <button
            type="submit"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            disabled={busy}
          >
            Continue
          </button>
        </form>
      )}

      {step === "focus" && (
        <div>
          <h1 className="title is-4">Tell us about your hiring</h1>
          <p className="subtitle is-6 has-text-secondary">
            We&apos;ll suggest starting defaults you can accept, edit, or skip.
          </p>

          <FormError message={error} />

          <div className="field">
            <label className="label" htmlFor="industry">
              Industry
            </label>
            <div className="control">
              <input
                id="industry"
                className="input"
                type="text"
                placeholder="e.g. IT services, BFSI, Manufacturing"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="size">
              Team size
            </label>
            <div className="control">
              <div className="select is-fullwidth">
                <select id="size" value={size} onChange={(e) => setSize(e.target.value)}>
                  {TEAM_SIZES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="field">
            <label className="label">Who do you hire for?</label>
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
                  checked={agencyMode === option.value}
                  onChange={() => setAgencyMode(option.value)}
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
            <p className="help has-text-secondary">
              You can change this later in Settings → Organization.
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="focus">
              What type of hiring do you mostly do?
            </label>
            <div className="control">
              <textarea
                id="focus"
                className="textarea"
                rows={3}
                maxLength={2000}
                placeholder="e.g. IT recruitment, mostly Java, React, DevOps"
                value={hiringFocus}
                onChange={(e) => setHiringFocus(e.target.value)}
              />
            </div>
          </div>

          <div className="buttons">
            {canUseAi && (
              <button
                type="button"
                className={`button is-primary ${busy ? "is-loading" : ""}`}
                onClick={generateSuggestions}
                disabled={busy || hiringFocus.trim().length < 3}
              >
                Suggest defaults with AI
              </button>
            )}
            <button
              type="button"
              className="button"
              onClick={() => setStep("review")}
              disabled={busy}
            >
              Skip AI suggestions
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div>
          <h1 className="title is-4">Review and finish</h1>
          <p className="subtitle is-6 has-text-secondary">
            {suggestions
              ? "These are suggestions only — nothing is saved until you finish."
              : "You can configure screening, pipeline, and interview defaults later in Settings."}
          </p>

          <FormError message={error} />

          {aiError && (
            <div className="mb-4">
              <p style={{ color: "var(--color-error)", fontSize: 14 }} role="alert">
                {aiError}
              </p>
              <button
                type="button"
                className="button is-small mt-2"
                onClick={generateSuggestions}
                disabled={busy}
              >
                Retry AI suggestions
              </button>
            </div>
          )}

          {suggestions && (
            <div className="ai-panel mb-4">
              <p
                className="mb-3"
                style={{ fontSize: 13, color: "var(--color-info)", fontWeight: 600 }}
              >
                AI-suggested defaults
              </p>
              <p className="mb-4" style={{ fontSize: 14 }}>
                {suggestions.rationale}
              </p>

              <SuggestionList title="Pipeline stages" items={suggestions.pipelineStages} />
              <SuggestionList title="Screening questions" items={suggestions.screeningQuestions} />
              <SuggestionList title="Interview rounds" items={suggestions.interviewRounds} />
              <SuggestionList title="Candidate fields" items={suggestions.candidateFields} />
              <SuggestionList
                title="Automation ideas"
                items={suggestions.automationTemplates}
              />

              <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
                These become editable defaults once Jobs, Pipeline, and Settings are available.
                Nothing is activated automatically.
              </p>
            </div>
          )}

          <div className="buttons">
            <button
              type="button"
              className={`button is-primary ${busy ? "is-loading" : ""}`}
              onClick={finish}
              disabled={busy}
            >
              Finish setup
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setStep("focus")}
              disabled={busy}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-3">
      <p style={{ fontSize: 13, fontWeight: 600 }}>{title}</p>
      <ul style={{ fontSize: 14, listStyle: "disc", paddingLeft: "1.25rem" }}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
