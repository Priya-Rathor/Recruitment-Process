// =============================================================================
// The four hiring stages.
//
// One place that says what the stages ARE, so the form, the modal, the API, the
// job detail page and the database check constraint cannot drift apart.
//
// `execution` is the honest part. Only one of these four can actually run: the
// AI screening call has Module 8's Bolna integration behind it. The other three
// have a configuration layer and nothing else — no video calling, no assessment
// delivery. Recording that here rather than in a comment means the UI can SAY
// so on the row, which is what stops a recruiter enabling "Video Interview" and
// waiting for something to happen.
// =============================================================================

export const STAGE_KEYS = [
  "ai_screening_call",
  "phone_interview",
  "video_interview",
  "written_assessment",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === "string" && (STAGE_KEYS as readonly string[]).includes(value);
}

export type StageExecution =
  /** Wired to a real engine — enabling it changes what happens to candidates. */
  | "live"
  /** Configuration is saved and displayed; nothing runs it yet. */
  | "configuration_only";

export type StageDefinition = {
  key: StageKey;
  label: string;
  description: string;
  execution: StageExecution;
  /** Names the engine, so "live" is a checkable claim rather than a promise. */
  engine: string | null;
};

export const STAGES: StageDefinition[] = [
  {
    key: "ai_screening_call",
    label: "AI Screening Call",
    description: "Automated call screening candidates before recruiter review",
    execution: "live",
    engine: "Bolna (Module 8)",
  },
  {
    key: "phone_interview",
    label: "Phone Interview",
    description: "A recruiter calls the candidate and works through set questions",
    execution: "configuration_only",
    engine: null,
  },
  {
    key: "video_interview",
    label: "Video Interview",
    description: "A scheduled video call with the hiring team",
    execution: "configuration_only",
    engine: null,
  },
  {
    key: "written_assessment",
    label: "Written Assessment",
    description: "A take-home or timed written test",
    execution: "configuration_only",
    engine: null,
  },
];

const BY_KEY = new Map(STAGES.map((stage) => [stage.key, stage]));

export function stageDefinition(key: StageKey): StageDefinition {
  const found = BY_KEY.get(key);
  // Unreachable through the type system; a throw beats returning a fake stage
  // whose label would then appear in the UI as "undefined".
  if (!found) throw new Error(`Unknown hiring stage: ${key}`);
  return found;
}

/** The note shown on rows that cannot run yet. */
export const CONFIGURATION_ONLY_NOTE = "Not yet active — configuration only";

/**
 * The placeholder-aware default script offered when a stage is first enabled.
 *
 * A blank textarea is the single biggest reason a configuration screen gets
 * abandoned: it asks the recruiter to invent both the content AND the format.
 * These are starting points that demonstrate the token syntax in context, so
 * the field picker's purpose is obvious without reading the helper text.
 *
 * NOT written to the database on enable — only offered in the editor. A stage
 * the recruiter enabled and then cancelled out of must not end up with a script
 * nobody chose.
 */
export const STARTER_TEMPLATES: Record<StageKey, string> = {
  ai_screening_call:
    "You are screening {{candidate.name}} for the {{job.title}} role at {{job.client_name}}.\n\n" +
    "Confirm they are still interested, then work through the screening questions below. " +
    "Keep it under five minutes and stay conversational.\n\n" +
    "Context you may refer to: they are currently {{candidate.current_role}} at " +
    "{{candidate.current_company}} with {{candidate.total_experience}} of experience, and the " +
    "role is based in {{job.location}} ({{job.work_mode}}).",
  phone_interview:
    "Phone interview with {{candidate.name}} for {{job.title}}.\n\n" +
    "Open by confirming the basics: {{candidate.notice_period}} notice and an expectation of " +
    "{{candidate.expected_salary}}. Then explore their depth in {{job.required_skills}}.\n\n" +
    "Close by explaining the next step and when they will hear from us.",
  video_interview:
    "Video interview with {{candidate.name}} for {{job.title}}.\n\n" +
    "They come from {{candidate.current_company}} with {{candidate.total_experience}} of " +
    "experience and matched this role at {{application.match_score}}.\n\n" +
    "Focus on how they have applied {{job.required_skills}} in production, and give them time " +
    "to ask about the team.",
  written_assessment:
    "Written assessment for {{candidate.name}} — {{job.title}}.\n\n" +
    "Instructions to send with the assessment:\n" +
    "Answer the questions below in your own words. Practical examples from your work at " +
    "{{candidate.current_company}} are welcome.",
};
