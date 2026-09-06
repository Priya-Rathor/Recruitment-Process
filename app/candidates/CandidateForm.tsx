"use client";

// Create/edit form with AI structuring of a free-text paste.
//
// Two rules from the spec are enforced here rather than hoped for:
//  1. "AI never overwrites an existing verified field silently" —
//     mergeCandidateProposal() fills blanks and reports conflicts.
//  2. "System checks for duplicates before creating a new candidate record" —
//     the API returns 409 with the suspected matches, and the recruiter must
//     explicitly acknowledge before the record is created.
import { CustomFieldsSection, toDraft, type DraftValues } from "@/components/CustomFieldsSection";
import type { CustomFieldDefinition } from "@/lib/customFields/definitions";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormError } from "@/components/states";
import type { EducationEntry, EmploymentEntry } from "@/lib/candidates/profile";
import { RepeatableEditor } from "./RepeatableEditor";
import {
  mergeCandidateProposal,
  type CandidateFieldConflict,
  type CandidateProposal,
} from "@/lib/ai/structureCandidateText";
import {
  CANDIDATE_SOURCES,
  CANDIDATE_SOURCE_LABELS,
  type Candidate,
  type CandidateSource,
} from "@/lib/types";

type SuspectedDuplicate = {
  id: string;
  name: string | null;
  matched_on: ("email" | "phone")[];
};

type FormState = {
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentCompany: string | null;
  currentRole: string | null;
  totalExperienceYears: number | null;
  skills: string[];
  education: EducationEntry[];
  employmentHistory: EmploymentEntry[];
  expectedSalary: number | null;
  noticePeriodDays: number | null;
  source: CandidateSource;
};

function emptyForm(): FormState {
  return {
    name: "",
    email: null,
    phone: null,
    location: null,
    currentCompany: null,
    currentRole: null,
    totalExperienceYears: null,
    skills: [],
    education: [],
    employmentHistory: [],
    expectedSalary: null,
    noticePeriodDays: null,
    source: "manual",
  };
}

function formFromCandidate(candidate: Candidate): FormState {
  return {
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    currentCompany: candidate.current_company,
    currentRole: candidate.current_role,
    totalExperienceYears: candidate.total_experience_years,
    skills: candidate.skills ?? [],
    education: candidate.education ?? [],
    employmentHistory: candidate.employment_history ?? [],
    expectedSalary: candidate.expected_salary,
    noticePeriodDays: candidate.notice_period_days,
    source: candidate.source,
  };
}

function numberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function CandidateForm({
  mode,
  candidate,
  customFields = [],
  initialCustomValues = {},
}: {
  mode: "create" | "edit";
  candidate?: Candidate;
  /**
   * MODULE 27 — active candidate-level custom fields.
   *
   * ADDITIVE ONLY. These render after the fixed fields and write to
   * custom_field_values through their own endpoint. They do not touch name,
   * email or phone, and cannot: the reserved-key constraint in migration 0039
   * refuses those keys outright, so no custom field can become a second,
   * differently-permissioned way to edit a candidate's identity. The rule that
   * those three are editable only here is untouched by this section.
   */
  customFields?: CustomFieldDefinition[];
  initialCustomValues?: Record<string, unknown>;
}) {
  const router = useRouter();

  const [form, setForm] = useState<FormState>(() =>
    candidate ? formFromCandidate(candidate) : emptyForm()
  );
  const [customDraft, setCustomDraft] = useState<DraftValues>(() =>
    toDraft(customFields, initialCustomValues)
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pasted, setPasted] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<CandidateFieldConflict[]>([]);
  const [structured, setStructured] = useState(false);

  const [duplicates, setDuplicates] = useState<SuspectedDuplicate[]>([]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    // A contact change invalidates the previous duplicate verdict.
    if (key === "email" || key === "phone") setDuplicates([]);
  }

  async function structure() {
    setStructuring(true);
    setAiError(null);
    setConflicts([]);

    try {
      const response = await fetch("/api/candidates/ai-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasted }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        // Structuring failing must never block manual entry.
        setAiError(
          payload?.error ?? "Couldn't read those details. You can fill the form in manually."
        );
        return;
      }

      const proposal = payload.data as CandidateProposal;
      const { merged, conflicts: found } = mergeCandidateProposal(
        {
          name: form.name.trim() === "" ? null : form.name,
          email: form.email,
          phone: form.phone,
          location: form.location,
          currentCompany: form.currentCompany,
          currentRole: form.currentRole,
          totalExperienceYears: form.totalExperienceYears,
          expectedSalary: form.expectedSalary,
          noticePeriodDays: form.noticePeriodDays,
        },
        proposal
      );

      setForm((current) => ({
        ...current,
        name: merged.name ?? "",
        email: merged.email,
        phone: merged.phone,
        location: merged.location,
        currentCompany: merged.currentCompany,
        currentRole: merged.currentRole,
        totalExperienceYears: merged.totalExperienceYears,
        expectedSalary: merged.expectedSalary,
        noticePeriodDays: merged.noticePeriodDays,
        // Skills are additive — nothing the recruiter typed is dropped.
        skills: unionSkills(current.skills, proposal.skills),
      }));

      setConflicts(found);
      setStructured(true);
      setDirty(true);
      setDuplicates([]);
    } catch {
      setAiError("Couldn't reach the AI service. You can fill the form in manually.");
    } finally {
      setStructuring(false);
    }
  }

  async function save(acknowledgeDuplicates = false) {
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      location: form.location,
      current_company: form.currentCompany,
      current_role: form.currentRole,
      total_experience_years: form.totalExperienceYears,
      skills: form.skills,
      education: form.education,
      employment_history: form.employmentHistory,
      expected_salary: form.expectedSalary,
      notice_period_days: form.noticePeriodDays,
      source: form.source,
      ...(acknowledgeDuplicates ? { acknowledge_duplicates: true } : {}),
    };

    const response = await fetch(
      mode === "create" ? "/api/candidates" : `/api/candidates/${candidate!.id}`,
      {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json().catch(() => null);
    setSaving(false);

    // The duplicate check speaks first: warn, don't block.
    if (response.status === 409 && result?.code === "duplicate_suspected") {
      setDuplicates(result.duplicates as SuspectedDuplicate[]);
      return;
    }

    if (!response.ok) {
      setError(result?.error ?? "Could not save the candidate.");
      return;
    }

    const id = mode === "create" ? (result.data as Candidate).id : candidate!.id;

    /*
      MODULE 27 — custom values, written after the candidate exists. On create
      there is no candidate id until the request above returns, exactly as with
      a job's custom fields. A failure here does not discard the candidate.
    */
    if (customFields.length > 0) {
      await fetch("/api/custom-fields/values", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "candidate",
          entity_id: id,
          values: customDraft,
        }),
      });
    }

    setDirty(false);
    router.push(`/candidates/${id}`);
    router.refresh();
  }

  return (
    <div>
      <FormError message={error} />

      {/* ---- Duplicate warning ------------------------------------------- */}
      {duplicates.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            This candidate may already exist
          </h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            We found {duplicates.length === 1 ? "an existing record" : "existing records"} with the
            same contact details. Open the existing record, or continue if this is genuinely a
            different person.
          </p>

          <ul className="mb-4">
            {duplicates.map((duplicate) => (
              <li key={duplicate.id} className="py-2">
                <Link href={`/candidates/${duplicate.id}`} style={{ fontWeight: 600 }}>
                  {duplicate.name ?? "Existing candidate"}
                </Link>
                <span className="has-text-secondary" style={{ fontSize: 13 }}>
                  {" "}
                  — matched on {duplicate.matched_on.join(" and ")}
                </span>
              </li>
            ))}
          </ul>

          <div className="buttons">
            <button
              type="button"
              className={`button is-primary ${saving ? "is-loading" : ""}`}
              onClick={() => save(true)}
              disabled={saving}
            >
              Create anyway
            </button>
            <button type="button" className="button" onClick={() => setDuplicates([])}>
              Go back and edit
            </button>
          </div>
        </div>
      )}

      {/* ---- AI structuring ---------------------------------------------- */}
      <div className="card mb-4">
        <h2 className="title is-5">Paste candidate details</h2>
        <p className="subtitle is-6 has-text-secondary">
          Paste an email, referral note, or profile blurb and AI will fill in the fields below. For
          resume files, use the resume upload on the candidate&apos;s page (Module 6).
        </p>

        <div className="field">
          <textarea
            className="textarea"
            rows={4}
            placeholder="e.g. Rahul Sharma, Software Engineer at Infosys, 5 yrs Java/Spring Boot, Gurgaon, expects 19 LPA, 30 days notice, rahul@example.com, 9876543210"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
          />
        </div>

        <button
          type="button"
          className={`button is-primary ${structuring ? "is-loading" : ""}`}
          onClick={structure}
          disabled={structuring || pasted.trim().length < 10}
        >
          {structured ? "Read again" : "Read with AI"}
        </button>

        {aiError && (
          <p className="mt-3" style={{ fontSize: 14, color: "var(--color-error)" }} role="alert">
            {aiError}
          </p>
        )}

        {structured && !aiError && (
          <p className="mt-3" style={{ fontSize: 13, color: "var(--color-info)" }}>
            Blank fields were filled from your text. Review before saving.
          </p>
        )}
      </div>

      {/* ---- Conflicts ---------------------------------------------------- */}
      {conflicts.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            Kept your values
          </h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            AI read these differently. Your entries were kept — change one only if you want to.
          </p>
          <table className="table is-fullwidth" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Yours (kept)</th>
                <th>AI read</th>
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

      {/* ---- Profile fields ----------------------------------------------- */}
      <div className="card mb-4">
        <h2 className="title is-5">Profile</h2>

        <div className="field">
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            className="input"
            type="text"
            maxLength={200}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
          />
        </div>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={form.email ?? ""}
              onChange={(event) => update("email", event.target.value || null)}
            />
          </div>
          <div className="column">
            <label className="label" htmlFor="phone">
              Phone
            </label>
            <input
              id="phone"
              className="input"
              type="tel"
              value={form.phone ?? ""}
              onChange={(event) => update("phone", event.target.value || null)}
            />
          </div>
        </div>
        <p className="help has-text-secondary mb-4">
          At least one of email or phone is required. Both are used to detect duplicates.
        </p>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="company">
              Current company
            </label>
            <input
              id="company"
              className="input"
              type="text"
              value={form.currentCompany ?? ""}
              onChange={(event) => update("currentCompany", event.target.value || null)}
            />
          </div>
          <div className="column">
            <label className="label" htmlFor="role">
              Current role
            </label>
            <input
              id="role"
              className="input"
              type="text"
              value={form.currentRole ?? ""}
              onChange={(event) => update("currentRole", event.target.value || null)}
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
            <label className="label" htmlFor="experience">
              Total experience (years)
            </label>
            <input
              id="experience"
              className="input"
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={form.totalExperienceYears ?? ""}
              onChange={(event) =>
                update("totalExperienceYears", numberOrNull(event.target.value))
              }
            />
          </div>
        </div>

        <div className="columns">
          <div className="column">
            <label className="label" htmlFor="salary">
              Expected salary (annual)
            </label>
            <input
              id="salary"
              className="input"
              type="number"
              min={0}
              value={form.expectedSalary ?? ""}
              onChange={(event) => update("expectedSalary", numberOrNull(event.target.value))}
            />
          </div>
          <div className="column">
            <label className="label" htmlFor="notice">
              Notice period (days)
            </label>
            <input
              id="notice"
              className="input"
              type="number"
              min={0}
              max={365}
              value={form.noticePeriodDays ?? ""}
              onChange={(event) => update("noticePeriodDays", numberOrNull(event.target.value))}
            />
          </div>
        </div>

        <SkillEditor skills={form.skills} onChange={(skills) => update("skills", skills)} />

        {/* Repeatable history. Both lists drop entirely blank rows on save, so
            an accidental Add costs nothing — see lib/candidates/profile.ts. */}
        <div className="mt-5">
          <RepeatableEditor<EducationEntry>
            label="Education"
            help="Qualifications, most recent first."
            entries={form.education}
            onChange={(education) => update("education", education)}
            blank={() => ({ degree: null, institution: null, year: null })}
            addLabel="Add qualification"
            emptyText="No qualifications recorded."
            fields={[
              { key: "degree", label: "Degree", placeholder: "B.Tech Computer Science" },
              { key: "institution", label: "Institution", placeholder: "Delhi Technological University" },
              { key: "year", label: "Year", placeholder: "2019", width: "is-one-quarter" },
            ]}
          />
        </div>

        <div className="mt-5">
          <RepeatableEditor<EmploymentEntry>
            label="Employment history"
            help="Previous companies, most recent first."
            entries={form.employmentHistory}
            onChange={(employmentHistory) => update("employmentHistory", employmentHistory)}
            blank={() => ({ company: null, role: null, duration: null })}
            addLabel="Add employer"
            emptyText="No previous employers recorded."
            fields={[
              { key: "company", label: "Company", placeholder: "Infosys" },
              { key: "role", label: "Role", placeholder: "Senior Java Developer" },
              { key: "duration", label: "Duration", placeholder: "2022 – present", width: "is-one-quarter" },
            ]}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="source">
            Intake source
          </label>
          <div className="select is-fullwidth">
            <select
              id="source"
              value={form.source}
              onChange={(event) => update("source", event.target.value as CandidateSource)}
            >
              {CANDIDATE_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {CANDIDATE_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </div>
          <p className="help has-text-secondary">
            Used by source-performance reporting in Analytics.
          </p>
        </div>
      </div>

      {/* ---- MODULE 27: this organization's own candidate fields ----------
          After every fixed field, before the save bar, so one Save commits the
          whole page. Renders nothing when none are configured. */}
      <CustomFieldsSection
        entityType="candidate"
        definitions={customFields}
        values={initialCustomValues}
        onChange={(next) => {
          setCustomDraft(next);
          setDirty(true);
        }}
        canEdit
      />

      {/* ---- Explicit save + unsaved indicator ---------------------------- */}
      <div className="card">
        <div className="is-flex is-justify-content-space-between is-align-items-center">
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {dirty ? "You have unsaved changes." : "No unsaved changes."}
          </p>
          <div className="buttons mb-0">
            <button
              type="button"
              className={`button is-primary ${saving ? "is-loading" : ""}`}
              onClick={() => save(false)}
              disabled={saving || form.name.trim().length === 0}
            >
              {mode === "create" ? "Add candidate" : "Save changes"}
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                router.push(mode === "create" ? "/candidates" : `/candidates/${candidate!.id}`)
              }
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
  skills,
  onChange,
}: {
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
      <label className="label">Skills</label>
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
          <button type="button" className="button" onClick={add}>
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
    </div>
  );
}
