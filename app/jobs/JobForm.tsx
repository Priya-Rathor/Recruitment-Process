"use client";

// Create/edit form, including the AI-assisted flow from spec section 7:
//   1. Recruiter pastes a raw job description
//   2. AI extracts structured fields
//   3. Recruiter reviews/edits before saving  <- enforced by mergeProposal()
//   4. AI drafts screening + interview questions, recruiter accepts or edits
//   5. Job is saved and appears in the list with a health indicator
//
// The critical rule: AI fills only BLANK fields. Where the recruiter has already
// typed something different, their value is kept and the difference is shown as a
// conflict for them to resolve. AI never silently overwrites.
import { CustomFieldsSection, toDraft, type DraftValues } from "@/components/CustomFieldsSection";
import { customPlaceholderFields } from "@/lib/customFields/placeholders";
import type { CustomFieldDefinition } from "@/lib/customFields/definitions";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import { HiringStages, emptyStages, type StagesState } from "./HiringStages";
import { STAGES } from "@/lib/hiring-stages/catalog";
import type { StageConfig } from "@/lib/hiring-stages/config";
import { mergeProposal, type FieldConflict, type JobProposal } from "@/lib/ai/extractJobFromDescription";
import {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  type Job,
  type JobStatus,
  type WorkMode,
} from "@/lib/types";

type FormState = {
  title: string;
  description: string;
  experienceMin: number | null;
  experienceMax: number | null;
  requiredSkills: string[];
  preferredSkills: string[];
  location: string | null;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  ownerRecruiterId: string;
  /** Module 12 retrofit: jobs can now be attached to a client. */
  clientId: string;
  screeningQuestions: string[];
};

function emptyForm(): FormState {
  return {
    title: "",
    description: "",
    experienceMin: null,
    experienceMax: null,
    requiredSkills: [],
    preferredSkills: [],
    location: null,
    workMode: null,
    salaryMin: null,
    salaryMax: null,
    status: "draft",
    ownerRecruiterId: "",
    clientId: "",
    screeningQuestions: [],
  };
}

function formFromJob(job: Job, screening: string[]): FormState {
  return {
    title: job.title,
    description: job.description ?? "",
    experienceMin: job.experience_min,
    experienceMax: job.experience_max,
    requiredSkills: job.required_skills ?? [],
    preferredSkills: job.preferred_skills ?? [],
    location: job.location,
    workMode: job.work_mode,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    status: job.status,
    ownerRecruiterId: job.owner_recruiter_id ?? "",
    clientId: job.client_id ?? "",
    screeningQuestions: screening,
  };
}

/** Parses a number input, treating an empty field as "not specified". */
function numberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function JobForm({
  mode,
  job,
  initialScreeningQuestions = [],
  members,
  clients,
  agencyMode,
  currentUserId,
  canClose,
  initialStages,
  canEditStages = true,
  customFields = [],
  initialCustomValues = {},
}: {
  mode: "create" | "edit";
  job?: Job;
  initialScreeningQuestions?: string[];
  /** Existing stage rows, when editing. Absent on create. */
  initialStages?: StagesState;
  /** False for a Viewer, who may see the configuration but not change it. */
  canEditStages?: boolean;
  /** MODULE 27 — active job-level custom field definitions, in display order. */
  customFields?: CustomFieldDefinition[];
  /** Their current values, keyed by field_key. Empty when creating. */
  initialCustomValues?: Record<string, unknown>;
  members: { id: string; name: string; role: string }[];
  clients: { id: string; name: string }[];
  /**
   * False for an in-house organization, which recruits for itself and so has no
   * client to attach a job to. The field is hidden rather than disabled — a
   * permanently empty dropdown reads as something broken.
   */
  agencyMode: boolean;
  currentUserId: string;
  /** False for a Recruiter who doesn't own this job — they may edit, not close. */
  canClose: boolean;
}) {
  const router = useRouter();

  const [form, setForm] = useState<FormState>(() =>
    job
      ? formFromJob(job, initialScreeningQuestions)
      : { ...emptyForm(), ownerRecruiterId: currentUserId }
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hiring stages are held beside the form rather than inside FormState: they
  // save to their own endpoint, because on create the job has no id until the
  // first request returns.
  const [stages, setStages] = useState<StagesState>(() => initialStages ?? emptyStages());

  /*
    MODULE 27. The custom field draft, held here because the section is rendered
    in its controlled mode — on create there is no job id to save against until
    the job exists, so this form owns the values and writes them in handleSubmit.
  */
  const [customDraft, setCustomDraft] = useState<DraftValues>(() =>
    toDraft(customFields, initialCustomValues)
  );

  /* The stage script picker offers this job's custom fields too. */
  const jobPlaceholderFields = useMemo(
    () => customPlaceholderFields(customFields),
    [customFields]
  );

  // AI state
  const [pasted, setPasted] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<FieldConflict[]>([]);
  const [extracted, setExtracted] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function extract() {
    setExtracting(true);
    setAiError(null);
    setConflicts([]);

    try {
      const response = await fetch("/api/jobs/ai-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: pasted }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // Extraction failing must never block manual entry.
        setAiError(payload?.error ?? "Couldn't extract from that description. You can fill the form in manually.");
        return;
      }

      const proposal = payload.data as JobProposal;

      // Recruiter values win; blanks get filled; differences become conflicts.
      const { merged, conflicts: found } = mergeProposal(
        {
          title: form.title.trim() === "" ? null : form.title,
          experienceMin: form.experienceMin,
          experienceMax: form.experienceMax,
          location: form.location,
          workMode: form.workMode,
          salaryMin: form.salaryMin,
          salaryMax: form.salaryMax,
        },
        proposal
      );

      setForm((current) => ({
        ...current,
        title: merged.title ?? "",
        experienceMin: merged.experienceMin,
        experienceMax: merged.experienceMax,
        location: merged.location,
        workMode: merged.workMode,
        salaryMin: merged.salaryMin,
        salaryMax: merged.salaryMax,
        // Lists are additive: union rather than replace, so nothing typed is lost.
        requiredSkills: unionSkills(current.requiredSkills, proposal.requiredSkills),
        preferredSkills: unionSkills(current.preferredSkills, proposal.preferredSkills).filter(
          (skill) =>
            !unionSkills(current.requiredSkills, proposal.requiredSkills)
              .map((s) => s.toLowerCase())
              .includes(skill.toLowerCase())
        ),
        // Question sets are only ever suggested into an EMPTY list, never over
        // questions the recruiter already wrote.
        screeningQuestions:
          current.screeningQuestions.length > 0 ? current.screeningQuestions : proposal.screeningQuestions,
        // Keep the pasted text as the job description if none was set.
        description: current.description.trim() === "" ? pasted.trim() : current.description,
      }));

      // The AI's interview questions have no field of their own any more, so
      // they are seeded into BOTH interview stages' suggested lists — the same
      // both-not-one rule migration 0025 used, and for the same reason: the
      // proposal never says which round a question belongs to.
      //
      // Only into an EMPTY list, never over questions the recruiter wrote, and
      // it seeds the config without enabling the stage: proposing a question is
      // not the same as deciding the job runs that round.
      if (proposal.interviewQuestions.length > 0) {
        setStages((current) => {
          const next = { ...current };
          for (const key of ["phone_interview", "video_interview"] as const) {
            const config = next[key].config as StageConfig & { questions: string[] };
            if ((config.questions ?? []).length === 0) {
              next[key] = {
                ...next[key],
                config: { ...config, questions: [...proposal.interviewQuestions] } as StageConfig,
              };
            }
          }
          return next;
        });
      }

      setConflicts(found);
      setExtracted(true);
      setDirty(true);
    } catch {
      setAiError("Couldn't reach the AI service. You can fill the form in manually.");
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);

    const payload = {
      title: form.title,
      description: form.description || null,
      experience_min: form.experienceMin,
      experience_max: form.experienceMax,
      required_skills: form.requiredSkills,
      preferred_skills: form.preferredSkills,
      location: form.location,
      work_mode: form.workMode,
      salary_min: form.salaryMin,
      salary_max: form.salaryMax,
      status: form.status,
      owner_recruiter_id: form.ownerRecruiterId || null,
      client_id: form.clientId || null,
      screening_questions: form.screeningQuestions,
      // interview_questions is NOT sent any more. The generic list was split
      // into the Phone Interview and Video Interview stages' own "Suggested
      // questions", and migration 0025 copied the old rows into both. Sending
      // it would write to a table nothing reads.
    };

    const response = await fetch(mode === "create" ? "/api/jobs" : `/api/jobs/${job!.id}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(result?.error ?? "Could not save the job.");
      return;
    }

    const id = mode === "create" ? (result.data as Job).id : job!.id;

    // Stages are saved SECOND, and only after the job exists — on create there
    // is no job id to attach them to until the request above returns.
    //
    // A failure here does not discard the job that was just saved. The job is
    // the important half; the stages can be set again from the edit page, and
    // losing a valid job because a stage row would not write would be a far
    // worse trade.
    const stagesResponse = await fetch(`/api/jobs/${id}/hiring-stages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stages: STAGES.map((stage) => ({
          stage_key: stage.key,
          enabled: stages[stage.key].enabled,
          prompt_template: stages[stage.key].promptTemplate,
          config: stages[stage.key].config,
        })),
      }),
    });

    /*
      MODULE 27 — custom field values, saved THIRD and for the same reason the
      stages are saved second: on create there is no job id to attach them to
      until the job exists.

      A failure here does not discard the job either. The values can be set
      again from the job form, and the section reports its own errors when it
      owns the save (edit mode); here the job is the important half.
    */
    if (customFields.length > 0) {
      await fetch("/api/custom-fields/values", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: "job", entity_id: id, values: customDraft }),
      });
    }

    setDirty(false);

    // Navigate EITHER WAY. The job exists from this point on, so staying on the
    // create form would leave a live job behind an unsubmitted-looking form —
    // and a second click on "Create job" would make a duplicate. The stage
    // failure is carried to the job page instead, where it can be acted on.
    const query = stagesResponse.ok ? "" : "?stages_failed=1";
    router.push(`/jobs/${id}${query}`);
    router.refresh();
  }

  const statusOptions = JOB_STATUSES.filter(
    // A Recruiter who doesn't own the job cannot move it to closed.
    (status) => status !== "closed" || canClose || form.status === "closed"
  );

  return (
    <div>
      <FormError message={error} />

      {/* ---- Step 1-2: paste and extract ---------------------------------- */}
      {mode === "create" && (
        <div className="card mb-4">
          <h2 className="title is-5">Start from a job description</h2>
          <p className="subtitle is-6 has-text-secondary">
            Paste the description and AI will fill in the structured fields and draft questions. You
            review everything before saving.
          </p>

          <div className="field">
            <textarea
              className="textarea"
              rows={6}
              placeholder="Paste the full job description here…"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
          </div>

          <button
            type="button"
            className={`button is-primary ${extracting ? "is-loading" : ""}`}
            onClick={extract}
            disabled={extracting || pasted.trim().length < 40}
          >
            {extracted ? "Extract again" : "Extract with AI"}
          </button>

          {aiError && (
            <p className="mt-3" style={{ fontSize: 14, color: "var(--color-error)" }} role="alert">
              {aiError}
            </p>
          )}

          {extracted && !aiError && (
            <p className="mt-3" style={{ fontSize: 13, color: "var(--color-info)" }}>
              Fields below were filled from the description. Review and edit before saving.
            </p>
          )}
        </div>
      )}

      {/* ---- Conflicts: AI disagreed with something already typed --------- */}
      {conflicts.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            Kept your values
          </h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            AI read these differently. Your entries were kept — apply a suggestion only if you want it.
          </p>
          <table className="table is-fullwidth" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Yours (kept)</th>
                <th>AI suggested</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((conflict) => (
                <tr key={conflict.field}>
                  <td>{conflict.field}</td>
                  <td style={{ fontWeight: 600 }}>{conflict.existing}</td>
                  <td className="has-text-secondary">{conflict.proposed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Step 3: structured fields ------------------------------------ */}
      <div className="card mb-4">
        <h2 className="title is-5">Job details</h2>

        <div className="field">
          <label className="label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="input"
            type="text"
            maxLength={200}
            value={form.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </div>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="exp-min">
              Experience from (years)
            </label>
            <input
              id="exp-min"
              className="input"
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={form.experienceMin ?? ""}
              onChange={(event) => update("experienceMin", numberOrNull(event.target.value))}
            />
          </div>
          <div className="column">
            <label className="label" htmlFor="exp-max">
              Experience to (years)
            </label>
            <input
              id="exp-max"
              className="input"
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={form.experienceMax ?? ""}
              onChange={(event) => update("experienceMax", numberOrNull(event.target.value))}
            />
          </div>
        </div>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="salary-min">
              Salary from
            </label>
            <input
              id="salary-min"
              className="input"
              type="number"
              min={0}
              value={form.salaryMin ?? ""}
              onChange={(event) => update("salaryMin", numberOrNull(event.target.value))}
            />
          </div>
          <div className="column">
            <label className="label" htmlFor="salary-max">
              Salary to
            </label>
            <input
              id="salary-max"
              className="input"
              type="number"
              min={0}
              value={form.salaryMax ?? ""}
              onChange={(event) => update("salaryMax", numberOrNull(event.target.value))}
            />
          </div>
        </div>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="location">
              Location
            </label>
            <input
              id="location"
              className="input"
              type="text"
              value={form.location ?? ""}
              onChange={(event) => update("location", event.target.value || null)}
            />
          </div>
          <div className="column">
            <label className="label" htmlFor="work-mode">
              Work mode
            </label>
            <div className="select is-fullwidth">
              <select
                id="work-mode"
                value={form.workMode ?? ""}
                onChange={(event) =>
                  update("workMode", (event.target.value || null) as WorkMode | null)
                }
              >
                <option value="">Not specified</option>
                {WORK_MODES.map((workMode) => (
                  <option key={workMode} value={workMode}>
                    {WORK_MODE_LABELS[workMode]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <SkillEditor
          label="Required skills"
          help="Mandatory. Used by candidate matching."
          skills={form.requiredSkills}
          onChange={(skills) => update("requiredSkills", skills)}
        />

        <SkillEditor
          label="Preferred skills"
          help="Nice to have. Kept separate from required."
          skills={form.preferredSkills}
          onChange={(skills) => update("preferredSkills", skills)}
        />

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="status">
              Status
            </label>
            <div className="select is-fullwidth">
              <select
                id="status"
                value={form.status}
                onChange={(event) => update("status", event.target.value as JobStatus)}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {JOB_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            {!canClose && (
              <p className="help has-text-secondary">
                Only the job&apos;s owner, an Admin, or the Owner can close it.
              </p>
            )}
          </div>
          {agencyMode && (
            <div className="column">
              <label className="label" htmlFor="client">
                Client
              </label>
              <div className="select is-fullwidth">
                <select
                  id="client"
                  value={form.clientId}
                  onChange={(event) => update("clientId", event.target.value)}
                >
                  <option value="">No client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="help has-text-secondary">
                Needed before candidates can be submitted for this job.
              </p>
            </div>
          )}

          <div className="column">
            <label className="label" htmlFor="owner">
              Owner
            </label>
            <div className="select is-fullwidth">
              <select
                id="owner"
                value={form.ownerRecruiterId}
                onChange={(event) => update("ownerRecruiterId", event.target.value)}
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
        </div>

        <div className="field">
          <label className="label" htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            className="textarea"
            rows={6}
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
          />
        </div>
      </div>

      {/* ---- Hiring stages ------------------------------------------------
          SCREENING QUESTIONS ARE NOT EDITED HERE ANY MORE.
          
          There used to be a standalone "Screening questions" card above this
          one. It and the list inside the AI Screening Call stage's
          configuration bound to the SAME state and wrote to the same
          job_screening_questions rows — one list rendered twice, which meant
          two places to look and two places to disagree about which was
          authoritative.
          
          The stage screen is the survivor: it is where max attempts, language
          and the call script already live, so the questions sit beside the
          things that shape how they are asked. `form.screeningQuestions` is
          still owned here and still saved on every submit, so a job whose
          stage is switched off keeps its questions untouched — they are hidden,
          never dropped. -------------------------------------------------- */}
      {/* ---- MODULE 27: this organization's own job fields ----------------
          After the fixed Details fields and before the stage configuration,
          which is where the brief puts them and where they read as "more about
          this job" rather than as part of the hiring process.

          CONTROLLED, with no entityId: on create there is no job to attach a
          value to yet, so the draft is held here and written by handleSubmit
          once the job has an id. Renders nothing when none are configured. */}
      <CustomFieldsSection
        entityType="job"
        definitions={customFields}
        values={initialCustomValues}
        onChange={(next) => {
          setCustomDraft(next);
          setDirty(true);
        }}
        canEdit={canEditStages}
      />

      <HiringStages
        customFields={jobPlaceholderFields}
        stages={stages}
        onChange={(next) => {
          setStages(next);
          setDirty(true);
        }}
        screeningQuestions={form.screeningQuestions}
        onScreeningQuestionsChange={(questions) => update("screeningQuestions", questions)}
        readOnly={!canEditStages}
      />

      {/* ---- Explicit save + unsaved indicator (spec section 8) ----------- */}
      <div className="card">
        <div className="is-flex is-justify-content-space-between is-align-items-center">
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {dirty ? "You have unsaved changes." : "No unsaved changes."}
          </p>
          <div className="buttons mb-0">
            <button
              type="button"
              className={`button is-primary ${saving ? "is-loading" : ""}`}
              onClick={save}
              disabled={saving || form.title.trim().length === 0}
            >
              {mode === "create" ? "Create job" : "Save changes"}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => router.push(mode === "create" ? "/jobs" : `/jobs/${job!.id}`)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Case-insensitive union preserving the first spelling seen. */
function unionSkills(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((skill) => skill.toLowerCase()));
  const output = [...existing];
  for (const skill of incoming) {
    if (seen.has(skill.toLowerCase())) continue;
    seen.add(skill.toLowerCase());
    output.push(skill);
  }
  return output;
}

function SkillEditor({
  label,
  help,
  skills,
  onChange,
}: {
  label: string;
  help: string;
  skills: string[];
  onChange: (skills: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (value === "") return;
    if (skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...skills, value]);
    setDraft("");
  }

  return (
    <div className="field">
      <label className="label">{label}</label>
      <div className="field has-addons mb-2">
        <div className="control is-expanded">
          <input
            className="input"
            type="text"
            placeholder="Add a skill and press Enter"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </div>
        <div className="control">
          <button type="button" className="button is-primary" onClick={add}>
            Add
          </button>
        </div>
      </div>

      {skills.length > 0 && (
        <div className="tags">
          {skills.map((skill) => (
            <span key={skill} className="tag is-light">
              {skill}
              <button
                type="button"
                className="delete is-small"
                aria-label={`Remove ${skill}`}
                onClick={() => onChange(skills.filter((item) => item !== skill))}
              />
            </span>
          ))}
        </div>
      )}
      <p className="help has-text-secondary">{help}</p>
    </div>
  );
}

