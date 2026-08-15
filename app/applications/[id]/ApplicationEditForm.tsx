"use client";

// =============================================================================
// Editing an application.
//
// WHAT IS NOT HERE IS THE POINT. Name, email and phone belong to the CANDIDATE,
// and one candidate can hold five applications — letting any of them edit the
// person's phone number means five screens racing to own one fact.
//
// So this form has no identity fields at all, not even as a read-only toggle,
// and the page shows those details with a link to the candidate instead. The
// API refuses them too (lib/applications/validation.ts): the UI is a
// convenience, not a boundary, and this endpoint is reachable by curl.
//
// Explicit Save, never autosave — the same rule as every other edit form here.
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import {
  APPLICATION_PRIORITIES,
  PRIORITY_LABELS,
  type ApplicationPriority,
} from "@/lib/applications/validation";
import { CANDIDATE_SOURCES, CANDIDATE_SOURCE_LABELS, type CandidateSource } from "@/lib/types";

export function ApplicationEditForm({
  applicationId,
  initial,
  members,
  onDone,
}: {
  applicationId: string;
  initial: {
    assignedRecruiterId: string | null;
    source: CandidateSource;
    priority: ApplicationPriority;
  };
  members: { id: string; name: string; role: string }[];
  onDone: () => void;
}) {
  const router = useRouter();

  const [recruiterId, setRecruiterId] = useState(initial.assignedRecruiterId ?? "");
  const [source, setSource] = useState<CandidateSource>(initial.source);
  const [priority, setPriority] = useState<ApplicationPriority>(initial.priority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    recruiterId !== (initial.assignedRecruiterId ?? "") ||
    source !== initial.source ||
    priority !== initial.priority;

  async function save() {
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Only application-level fields. Sending a candidate field here would be
      // refused with a 422 — see rejectCandidateFields().
      body: JSON.stringify({
        assigned_recruiter_id: recruiterId || null,
        source,
        priority,
      }),
    });

    const result = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(result?.error ?? "Could not save these changes.");
      return;
    }

    onDone();
    router.refresh();
  }

  return (
    <div className="card mb-4">
      <h2 className="title is-5">Edit application</h2>
      <p className="has-text-secondary mb-4" style={{ fontSize: "var(--text-label)" }}>
        The candidate&apos;s name, email and phone are edited on their own page — they belong to
        the person, not to this application.
      </p>

      <FormError message={error} />

      <div className="columns is-variable is-3">
        <div className="column is-one-third">
          <label className="label" htmlFor="app-recruiter">Assigned recruiter</label>
          <div className="select is-fullwidth">
            <select
              id="app-recruiter"
              value={recruiterId}
              onChange={(event) => setRecruiterId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="column is-one-third">
          <label className="label" htmlFor="app-source">Source</label>
          <div className="select is-fullwidth">
            <select
              id="app-source"
              value={source}
              onChange={(event) => setSource(event.target.value as CandidateSource)}
            >
              {CANDIDATE_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {CANDIDATE_SOURCE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <p className="stage-field__help">
            How this candidate reached <em>this job</em> — separate from how they entered the
            system.
          </p>
        </div>

        <div className="column is-one-third">
          <label className="label" htmlFor="app-priority">Priority</label>
          <div className="select is-fullwidth">
            <select
              id="app-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as ApplicationPriority)}
            >
              {APPLICATION_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="is-flex is-justify-content-space-between is-align-items-center mt-4">
        <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
          {dirty ? "You have unsaved changes." : "No unsaved changes."}
        </p>
        <div className="is-flex" style={{ gap: "var(--space-2)" }}>
          <button type="button" className="button" onClick={onDone} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={`button is-primary ${saving ? "is-loading" : ""}`}
            onClick={save}
            disabled={saving || !dirty}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
