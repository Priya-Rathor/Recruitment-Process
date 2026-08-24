// =============================================================================
// Default Call Data — the organization's FALLBACKS, and the precedence rule.
//
// The console's spec is emphatic that this section must "connect to, not
// duplicate, the per-job AI Screening Call configuration already built in
// Module 3's Job Hiring Stages feature", and states the rule in the words the UI
// shows the user:
//
//   "These are used when a job doesn't specify its own AI Screening Call
//    configuration. A job's own settings (under Hiring Stages) always take
//    priority over these defaults."
//
// A sentence in the UI is not an implementation, so the rule lives here, once,
// as a pure function with tests — and both the read-only precedence PREVIEW and
// the real dialling path call the same function. A preview that computes
// precedence differently from the code that dials is worse than no preview,
// because it is believed.
//
// WHAT IS AND IS NOT AN OVERRIDE
// ------------------------------
// Jobs do not have an arbitrary key/value store, and inventing one here would be
// the duplication the spec forbids. So the job-level side of each row is the
// REAL field that already exists in Module 3's screening stage:
//
//   screening_questions -> job_screening_questions (the list Module 8 dials with)
//   language            -> job_hiring_stages.config.language
//   max_call_attempts   -> job_hiring_stages.config.maxAttempts
//   call_briefing       -> job_hiring_stages.prompt_template
//   company_name        -> the job's client name, when the org recruits for
//                          clients (Module 12) — a call about an Acme role should
//                          say Acme, not the agency's own name
//
// Any other key an admin adds is org-level only, and the preview says so in that
// row rather than implying an override exists.
//
// PURE MODULE. No database, no provider, no AI.
// =============================================================================

/** One organization-wide fallback value passed into every screening call. */
export type CallDataField = {
  /** snake_case, so it reads the same as the {{token}} vocabulary. */
  key: string;
  /** May contain {{field}} placeholders; rendered per candidate at call time. */
  value: string;
};

export type DefaultCallData = {
  fields: CallDataField[];
  /**
   * Used ONLY when a job has AI Screening Call enabled and its own question list
   * is still empty. Never merged with a job's list — a job that configured three
   * questions asks three, not three plus the org's five.
   */
  fallbackQuestions: string[];
};

export const CALL_DATA_LIMITS = {
  keyMax: 60,
  valueMax: 500,
  fieldCount: 25,
  questionMax: 500,
  questionCount: 12,
} as const;

/**
 * Keys the console offers as a starting point.
 *
 * The first two are the spec's own examples. They are SUGGESTIONS, not a closed
 * list — an admin can add their own — but offering them means the common case is
 * a click rather than a guess at a naming convention.
 */
export const SUGGESTED_CALL_DATA_KEYS: { key: string; label: string; hint: string }[] = [
  {
    key: "company_name",
    label: "Company name",
    hint: "What the agent calls your organization out loud.",
  },
  {
    key: "recruiter_signoff_name",
    label: "Recruiter sign-off name",
    hint: "Who the agent says will follow up.",
  },
  {
    key: "next_step_summary",
    label: "Next step",
    hint: "What the agent tells the candidate happens next.",
  },
  {
    key: "callback_window",
    label: "Callback window",
    hint: "When a candidate can expect to hear back.",
  },
];

/** Keys that have a real job-level equivalent. Used by the preview's wording. */
export const RESERVED_PRECEDENCE_KEYS = [
  "screening_questions",
  "language",
  "max_call_attempts",
  "call_briefing",
  "company_name",
] as const;

/**
 * Normalises a key to snake_case.
 *
 * Not merely cosmetic: the key becomes a variable name the agent's prompt
 * references, and "Company Name" / "company_name" / "companyName" arriving as
 * three separate fields is how an organization ends up with three company names
 * and no idea which one the call used.
 */
export function normalizeCallDataKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key.length === 0 ? null : key.slice(0, CALL_DATA_LIMITS.keyMax);
}

/**
 * Coerces stored jsonb into the shape above.
 *
 * Duplicate keys collapse to the FIRST occurrence, so the list the admin sees
 * top-to-bottom is the list that wins — the opposite (last wins) would mean a
 * field scrolled off the bottom of the section silently overrode the one they
 * were looking at.
 */
export function normalizeDefaultCallData(raw: unknown): DefaultCallData {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const seen = new Set<string>();
  const fields: CallDataField[] = [];

  if (Array.isArray(input.fields)) {
    for (const entry of input.fields) {
      if (typeof entry !== "object" || entry === null) continue;
      const candidate = entry as Record<string, unknown>;

      const key = normalizeCallDataKey(candidate.key);
      if (!key || seen.has(key)) continue;

      const value =
        typeof candidate.value === "string"
          ? candidate.value.trim().slice(0, CALL_DATA_LIMITS.valueMax)
          : "";

      seen.add(key);
      fields.push({ key, value });
      if (fields.length >= CALL_DATA_LIMITS.fieldCount) break;
    }
  }

  const fallbackQuestions = Array.isArray(input.fallbackQuestions)
    ? input.fallbackQuestions
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.slice(0, CALL_DATA_LIMITS.questionMax))
        .slice(0, CALL_DATA_LIMITS.questionCount)
    : [];

  return { fields, fallbackQuestions };
}

/** Convenience: the fields as a plain lookup. */
export function callDataToRecord(callData: DefaultCallData): Record<string, string> {
  return Object.fromEntries(callData.fields.map((field) => [field.key, field.value]));
}

// -----------------------------------------------------------------------------
// Precedence.
// -----------------------------------------------------------------------------

/** Where an effective value came from. */
export type PrecedenceSource = "job" | "organization" | "unset";

export type PrecedenceRow = {
  key: string;
  label: string;
  /** Display strings, already summarised for the table. Null means "not set". */
  orgDefault: string | null;
  jobOverride: string | null;
  effective: string | null;
  source: PrecedenceSource;
  /** Why this row can or cannot be overridden by a job. */
  note: string;
};

/** The organization side of the comparison. */
export type OrgCallDataContext = {
  callData: DefaultCallData;
  /** Module 17's organization_settings.screening_settings. */
  orgLanguage: string;
  orgMaxAttempts: number;
  /** The agent's base system prompt — the org-level briefing. */
  agentSystemPrompt: string;
  /** The agent's General → company name, used when no call-data field sets one. */
  agentCompanyName: string | null;
};

/** The job side. Exactly the fields Module 3's screening stage already holds. */
export type JobScreeningOverrides = {
  jobId: string;
  jobTitle: string;
  /** False when the job has AI Screening Call switched off (or has no stage row). */
  screeningEnabled: boolean;
  /** From job_screening_questions, in display order. */
  questions: string[];
  language: string | null;
  maxAttempts: number | null;
  promptTemplate: string | null;
  /** Module 12's client, when the organization recruits for clients. */
  clientName: string | null;
};

function summariseQuestions(questions: string[]): string | null {
  if (questions.length === 0) return null;
  const noun = questions.length === 1 ? "question" : "questions";
  return `${questions.length} ${noun} — "${questions[0].slice(0, 60)}${
    questions[0].length > 60 ? "…" : ""
  }"`;
}

function summarisePrompt(prompt: string | null): string | null {
  const trimmed = prompt?.trim();
  if (!trimmed) return null;
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

/**
 * Builds the precedence table.
 *
 * ONE FUNCTION, used by the read-only preview in the console AND by
 * resolveEffectiveCallData() below, which the dialling path uses. Nothing here
 * touches a database, so the preview cannot drift from the dial.
 */
export function resolveCallDataPrecedence({
  org,
  job,
}: {
  org: OrgCallDataContext;
  job: JobScreeningOverrides;
}): PrecedenceRow[] {
  const orgFields = callDataToRecord(org.callData);
  const rows: PrecedenceRow[] = [];

  const pick = (
    orgDefault: string | null,
    jobOverride: string | null
  ): { effective: string | null; source: PrecedenceSource } => {
    if (jobOverride !== null) return { effective: jobOverride, source: "job" };
    if (orgDefault !== null) return { effective: orgDefault, source: "organization" };
    return { effective: null, source: "unset" };
  };

  const push = (
    key: string,
    label: string,
    orgDefault: string | null,
    jobOverride: string | null,
    note: string
  ) => {
    const { effective, source } = pick(orgDefault, jobOverride);
    rows.push({ key, label, orgDefault, jobOverride, effective, source, note });
  };

  // --- Questions ------------------------------------------------------------
  // The row the whole section exists for: a job with its own list uses it, and
  // the org fallback is reached only by a job that has screening on and no list.
  push(
    "screening_questions",
    "Screening questions",
    summariseQuestions(org.callData.fallbackQuestions),
    summariseQuestions(job.questions),
    "A job's own question list (Hiring Stages → AI Screening Call) always wins."
  );

  // --- Company name ---------------------------------------------------------
  push(
    "company_name",
    "Company name",
    orgFields.company_name?.trim() || org.agentCompanyName,
    job.clientName?.trim() || null,
    "Overridden by the job's client, when the role belongs to one."
  );

  // --- Language -------------------------------------------------------------
  push(
    "language",
    "Language",
    org.orgLanguage,
    job.language,
    "Set per job under Hiring Stages → AI Screening Call."
  );

  // --- Attempts -------------------------------------------------------------
  push(
    "max_call_attempts",
    "Max call attempts",
    String(org.orgMaxAttempts),
    job.maxAttempts === null ? null : String(job.maxAttempts),
    "Set per job under Hiring Stages → AI Screening Call."
  );

  // --- Briefing -------------------------------------------------------------
  // NOT a replacement for the org prompt at dial time — buildCallScript() places
  // a job's briefing after the consent disclosure and the greeting. For the
  // purposes of "which text briefs this call", the job's is the one that applies.
  push(
    "call_briefing",
    "Call briefing",
    summarisePrompt(org.agentSystemPrompt),
    summarisePrompt(job.promptTemplate),
    "The job's script, when it has one. The consent disclosure always comes first."
  );

  // --- Everything else the admin added -------------------------------------
  for (const field of org.callData.fields) {
    if ((RESERVED_PRECEDENCE_KEYS as readonly string[]).includes(field.key)) continue;
    push(
      field.key,
      field.key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      field.value.trim() || null,
      null,
      "Organization-wide. Jobs have no per-job equivalent for this field."
    );
  }

  return rows;
}

/**
 * The questions a call will actually ask, and where they came from.
 *
 * Called by the dialling path AND by the console's precedence preview. The
 * `source` is returned rather than left for the caller to infer, because "these
 * came from the org fallback" is the fact the preview's Effective column has to
 * state — and inferring it from a list comparison in two places is how the two
 * end up disagreeing.
 */
export function resolveEffectiveQuestions({
  jobQuestions,
  fallbackQuestions,
}: {
  jobQuestions: string[];
  fallbackQuestions: string[];
}): { questions: string[]; source: PrecedenceSource } {
  const own = jobQuestions.map((q) => q.trim()).filter((q) => q.length > 0);
  if (own.length > 0) return { questions: own, source: "job" };

  const fallback = fallbackQuestions.map((q) => q.trim()).filter((q) => q.length > 0);
  if (fallback.length > 0) return { questions: fallback, source: "organization" };

  return { questions: [], source: "unset" };
}

/**
 * The flat key/value context a call is placed with.
 *
 * Derived from the same precedence rows the preview renders, so a value shown as
 * "effective" in the console is the value the provider receives. Rows with no
 * effective value are OMITTED rather than sent as empty strings — an agent told
 * `company_name: ""` says the empty string out loud.
 */
export function resolveEffectiveCallData({
  org,
  job,
}: {
  org: OrgCallDataContext;
  job: JobScreeningOverrides;
}): Record<string, string> {
  const context: Record<string, string> = {};

  for (const row of resolveCallDataPrecedence({ org, job })) {
    // Questions and the briefing travel as their own structured fields on the
    // call payload, not as flattened summary strings.
    if (row.key === "screening_questions" || row.key === "call_briefing") continue;
    if (row.effective === null) continue;
    context[row.key] = row.effective;
  }

  return context;
}
