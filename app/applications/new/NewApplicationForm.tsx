"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormError } from "@/components/states";
import { CANDIDATE_SOURCES, CANDIDATE_SOURCE_LABELS, type CandidateSource } from "@/lib/types";
import { PIPELINE_STAGES, STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";

export function NewApplicationForm({
  candidates,
  jobs,
  presetCandidateId,
  presetJobId,
}: {
  candidates: { id: string; name: string; current_role: string | null }[];
  jobs: { id: string; title: string; status: string }[];
  presetCandidateId?: string;
  presetJobId?: string;
}) {
  const router = useRouter();

  const [candidateId, setCandidateId] = useState(presetCandidateId ?? "");
  const [jobId, setJobId] = useState(presetJobId ?? "");
  const [stage, setStage] = useState<ApplicationStage>("new");
  const [source, setSource] = useState<CandidateSource>("manual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_id: candidateId, job_id: jobId, stage, source }),
    });

    const result = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setError(result?.error ?? "Could not create the application.");
      return;
    }

    router.push(`/applications/${result.data.id}`);
    router.refresh();
  }

  if (candidates.length === 0 || jobs.length === 0) {
    return (
      <div className="card">
        <h2 className="title is-5">Something is missing</h2>
        <p style={{ fontSize: 14 }}>
          {candidates.length === 0 && jobs.length === 0
            ? "You need at least one candidate and one job before you can start a pipeline."
            : candidates.length === 0
              ? "You need at least one candidate before you can start a pipeline."
              : "You need at least one open job before you can start a pipeline."}
        </p>
        <div className="buttons mt-4">
          {candidates.length === 0 && (
            <Link className="button is-primary" href="/candidates/new">
              Add a candidate
            </Link>
          )}
          {jobs.length === 0 && (
            <Link className="button" href="/jobs/new">
              Create a job
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="card mb-4">
        <FormError message={error} />

        <div className="field">
          <label className="label" htmlFor="candidate">
            Candidate
          </label>
          <div className="select is-fullwidth">
            <select
              id="candidate"
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
              required
            >
              <option value="">Choose a candidate…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.current_role ? ` — ${candidate.current_role}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="job">
            Job
          </label>
          <div className="select is-fullwidth">
            <select
              id="job"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              required
            >
              <option value="">Choose a job…</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                  {job.status !== "open" ? ` (${job.status})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="stage">
              Starting stage
            </label>
            <div className="select is-fullwidth">
              <select
                id="stage"
                value={stage}
                onChange={(event) => setStage(event.target.value as ApplicationStage)}
              >
                {PIPELINE_STAGES.map((option) => (
                  <option key={option} value={option}>
                    {STAGE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            {/* A referral can legitimately enter mid-pipeline. */}
            <p className="help has-text-secondary">Usually New, unless this is a referral.</p>
          </div>

          <div className="column">
            <label className="label" htmlFor="source">
              Source for this application
            </label>
            <div className="select is-fullwidth">
              <select
                id="source"
                value={source}
                onChange={(event) => setSource(event.target.value as CandidateSource)}
              >
                {CANDIDATE_SOURCES.map((option) => (
                  <option key={option} value={option}>
                    {CANDIDATE_SOURCE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <p className="help has-text-secondary">
              How they came to this job, which can differ from how they entered the system.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="buttons mb-0">
          <button
            type="submit"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            disabled={busy || !candidateId || !jobId}
          >
            Create application
          </button>
          <button
            type="button"
            className="button"
            onClick={() => router.push("/applications")}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
