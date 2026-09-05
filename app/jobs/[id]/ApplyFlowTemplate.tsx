"use client";

// =============================================================================
// "Apply the Default Recruitment Flow" — the one-click starting point.
//
// -----------------------------------------------------------------------------
// IT CONFIRMS BEFORE IT WRITES, AND IT SAYS WHAT IT WILL OVERWRITE.
//
// Applying replaces this job's stage action lists. On a job where somebody has
// already configured a stage, that is destructive, and a button that did it on
// the first click would be the kind of thing people learn to avoid pressing.
//
// The confirmation is not a generic "are you sure?" — it lists what is created,
// what is reused and what is replaced, because the answer to "are you sure?" is
// unknowable without those three facts.
//
// -----------------------------------------------------------------------------
// IT REPORTS THE TODO LIST, WHICH IS THE MOST IMPORTANT PART OF THE RESULT.
//
// Everything the flow creates is switched OFF: templates inactive, forms
// unpublished, stage lists in draft. A success message with no next step would
// read as "this is now running", and it is not — deliberately, because seven
// messages that go out over the organisation's name should be read by somebody
// first. The list the API returns is rendered verbatim.
// =============================================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { FormError } from "@/components/states";
import { DEFAULT_FLOW_DESCRIPTION, DEFAULT_FLOW_KEY, DEFAULT_FLOW_LABEL } from "@/lib/workflow/defaultFlow";

type ApplyResult = {
  templatesCreated: string[];
  templatesReused: string[];
  formsCreated: string[];
  formsReused: string[];
  listsSaved: number;
  todo: string[];
  note: string;
};

export function ApplyFlowTemplate({
  jobId,
  hasExistingWorkflow,
}: {
  jobId: string;
  /** Changes the confirmation's wording from "set up" to "replace". */
  hasExistingWorkflow: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/jobs/${jobId}/workflow/apply-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: DEFAULT_FLOW_KEY, confirm: true }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { data?: ApplyResult; error?: string }
      | null;

    setBusy(false);

    if (!response.ok || !payload?.data) {
      setError(payload?.error ?? "The flow couldn't be applied.");
      return;
    }

    setResult(payload.data);
    setConfirming(false);
    router.refresh();
  }

  if (result) {
    return (
      <div
        className="card mb-4"
        style={{ padding: 16, borderLeft: "3px solid var(--color-success)" }}
      >
        <p style={{ fontWeight: 600, fontSize: 14 }}>{DEFAULT_FLOW_LABEL} applied</p>
        <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
          {result.listsSaved} stage list{result.listsSaved === 1 ? "" : "s"} saved as drafts
          {result.templatesCreated.length > 0 &&
            `, ${result.templatesCreated.length} template${result.templatesCreated.length === 1 ? "" : "s"} created`}
          {result.templatesReused.length > 0 &&
            `, ${result.templatesReused.length} existing template${result.templatesReused.length === 1 ? "" : "s"} reused`}
          {result.formsCreated.length > 0 &&
            `, ${result.formsCreated.length} form${result.formsCreated.length === 1 ? "" : "s"} created`}
          .
        </p>

        <p className="label is-small mt-3 mb-1">Before any of this reaches a candidate</p>
        <ul style={{ fontSize: 13, paddingLeft: 18, listStyle: "disc" }}>
          {result.todo.map((item) => (
            <li key={item} style={{ marginBottom: 4 }}>
              {item}
            </li>
          ))}
        </ul>

        <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
          {result.note}
        </p>

        <button type="button" className="button is-small mt-3" onClick={() => setResult(null)}>
          Got it
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div
        className="card mb-4"
        style={{ padding: 16, borderLeft: "3px solid var(--color-warning)" }}
      >
        <p style={{ fontWeight: 600, fontSize: 14 }}>Apply {DEFAULT_FLOW_LABEL}?</p>

        <ul className="mt-2" style={{ fontSize: 13, paddingLeft: 18, listStyle: "disc" }}>
          <li style={{ marginBottom: 4 }}>
            {hasExistingWorkflow ? (
              <>
                <strong>Replaces this job&rsquo;s existing stage actions.</strong> Anything you
                have configured on a stage the flow covers is overwritten.
              </>
            ) : (
              <>Sets up actions on Applied, Shortlisted, AI Screening Call and Director Round.</>
            )}
          </li>
          <li style={{ marginBottom: 4 }}>
            Creates 7 message templates and 2 availability forms for your organisation — or
            reuses them if you already have ones with those names. <strong>Your wording is
            never overwritten.</strong>
          </li>
          <li>
            Everything is saved switched <strong>off</strong>: templates inactive, forms
            unpublished, stage lists in draft.
          </li>
        </ul>

        {error && <FormError message={error} />}

        <div className="is-flex mt-3" style={{ gap: "0.5rem" }}>
          <button
            type="button"
            className={`button is-small is-primary ${busy ? "is-loading" : ""}`}
            onClick={apply}
            disabled={busy}
          >
            Apply the flow
          </button>
          <button
            type="button"
            className="button is-small"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card mb-4" style={{ padding: 16 }}>
      <div
        className="is-flex is-justify-content-space-between is-align-items-flex-start"
        style={{ gap: "1rem", flexWrap: "wrap" }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 14 }}>{DEFAULT_FLOW_LABEL}</p>
          <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
            {DEFAULT_FLOW_DESCRIPTION}
          </p>
          <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
            A starting point, not a mode — every timing, template and threshold stays editable
            below afterwards.
          </p>
        </div>
        <button type="button" className="button is-small" onClick={() => setConfirming(true)}>
          <Sparkles size={13} /> <span className="ml-1">Apply</span>
        </button>
      </div>
    </div>
  );
}
