// =============================================================================
// Placeholder tokens for stage scripts.
//
// A recruiter writes one script per stage and it runs against every candidate,
// so the script has to reference "the candidate" rather than a person. These
// tokens are that reference: {{candidate.name}}, {{job.title}}.
//
// SUBSTITUTION HAPPENS AT RUN TIME, NEVER AT SAVE TIME. A stored script with a
// real name baked in would be wrong for every other candidate, and worse, would
// carry one candidate's details into another's call. `prompt_template` in the
// database always holds unresolved tokens; `renderTemplate()` is called with a
// specific job and candidate at the moment the stage actually runs.
//
// Pure module — no database, no AI. A token is a string substitution, which is
// a fact a computer can verify, so it belongs in code with tests rather than in
// a prompt.
// =============================================================================

/**
 * Which section of the picker a field appears under.
 *
 * "interview" and "organization" were added for Module 15's message templates.
 * Screening scripts never reference them — they are supplied by the catalogue a
 * caller passes in, not by PLACEHOLDER_FIELDS below — so a stage script cannot
 * accidentally offer a token that has no value at call time.
 */
export type PlaceholderGroup = "job" | "candidate" | "interview" | "organization";

export type PlaceholderField = {
  /** The token written in a script, without braces: "job.title". */
  token: string;
  label: string;
  group: PlaceholderGroup;
  /** Shown in the preview and in the picker, so the shape is never a surprise. */
  sample: string;
};

/**
 * The catalogue. Exactly the fields the spec lists, in the spec's order.
 *
 * Deliberately a CLOSED list rather than "any column on the row". An open list
 * would let a script reference a field that later gets renamed or removed, and
 * the failure would surface as a half-substituted sentence read aloud to a
 * candidate. It would also expose columns nobody intended to publish — a
 * script could quietly print an internal note or a recruiter's own id.
 */
export const PLACEHOLDER_FIELDS: PlaceholderField[] = [
  // --- Job -----------------------------------------------------------------
  { token: "job.title", label: "Job Title", group: "job", sample: "Senior Java Developer" },
  { token: "job.client_name", label: "Client Name", group: "job", sample: "Acme Financial" },
  { token: "job.location", label: "Location", group: "job", sample: "Gurgaon" },
  { token: "job.work_mode", label: "Work Mode", group: "job", sample: "Hybrid" },
  { token: "job.experience_range", label: "Experience Range", group: "job", sample: "4–7 years" },
  { token: "job.salary_range", label: "Salary Range", group: "job", sample: "₹18–24 LPA" },
  {
    token: "job.required_skills",
    label: "Required Skills",
    group: "job",
    sample: "Java, Spring Boot, PostgreSQL",
  },
  {
    token: "job.preferred_skills",
    label: "Preferred Skills",
    group: "job",
    sample: "Kafka, Kubernetes",
  },

  // --- Candidate / application ---------------------------------------------
  { token: "candidate.name", label: "Candidate Name", group: "candidate", sample: "Rahul Sharma" },
  {
    token: "candidate.email",
    label: "Candidate Email",
    group: "candidate",
    sample: "rahul.sharma@example.com",
  },
  {
    token: "candidate.current_company",
    label: "Current Company",
    group: "candidate",
    sample: "Infosys",
  },
  {
    token: "candidate.current_role",
    label: "Current Role",
    group: "candidate",
    sample: "Java Developer",
  },
  {
    token: "candidate.total_experience",
    label: "Total Experience",
    group: "candidate",
    sample: "6 years",
  },
  {
    token: "candidate.expected_salary",
    label: "Expected Salary",
    group: "candidate",
    sample: "₹20 LPA",
  },
  {
    token: "candidate.notice_period",
    label: "Notice Period",
    group: "candidate",
    sample: "30 days",
  },
  {
    token: "application.stage",
    label: "Application Stage",
    group: "candidate",
    sample: "Screening",
  },
  { token: "application.match_score", label: "Match Score", group: "candidate", sample: "82%" },
];

export const GROUP_LABELS: Record<PlaceholderGroup, string> = {
  job: "Job fields",
  candidate: "Candidate / application fields",
  interview: "Interview fields",
  organization: "Your organization",
};

const BY_TOKEN = new Map(PLACEHOLDER_FIELDS.map((field) => [field.token, field]));

/**
 * THE CATALOGUE IS NOW A PARAMETER, DEFAULTING TO THE STAGE-SCRIPT ONE.
 *
 * Module 15's message templates use this exact token vocabulary, editor and
 * renderer — the spec's "reuse that exact component, don't rebuild it" — but
 * they can also say {{interview.time}} and {{organization.name}}, which no
 * screening script can resolve.
 *
 * Widening PLACEHOLDER_FIELDS itself would have offered those tokens in the
 * stage-script picker, where they render as nothing and the failure is a
 * sentence read aloud to a candidate with a hole in it. So the functions take an
 * optional field list instead, and each caller passes the catalogue that is true
 * where it renders.
 */
function lookupFor(fields?: PlaceholderField[]): Map<string, PlaceholderField> {
  if (!fields) return BY_TOKEN;
  return new Map(fields.map((field) => [field.token, field]));
}

export function findPlaceholder(
  token: string,
  fields?: PlaceholderField[]
): PlaceholderField | null {
  return lookupFor(fields).get(token) ?? null;
}

/** Wraps a token for insertion: "job.title" -> "{{job.title}}". */
export function toToken(token: string): string {
  return `{{${token}}}`;
}

/**
 * Matches a token in a script.
 *
 * Inner whitespace is tolerated — `{{ job.title }}` is what someone types when
 * they write one by hand instead of using the picker, and refusing it would
 * turn a reasonable guess into a token read aloud verbatim on a phone call.
 */
export const TOKEN_PATTERN = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi;

/**
 * Every token used in a script, in first-appearance order, deduplicated.
 *
 * Includes tokens that are NOT in the catalogue — the caller needs to know
 * about those precisely because they will not resolve. Use `splitTokens()` to
 * separate the two.
 */
export function extractTokens(template: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];

  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1].toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    found.push(token);
  }

  return found;
}

/**
 * Splits a script's tokens into ones we can resolve and ones we cannot.
 *
 * The unknown list is what the UI warns about. An unknown token is not a
 * validation error — the script still saves — because refusing to save someone's
 * work over a typo is worse than showing them the typo. It IS surfaced, because
 * the alternative is an agent saying "{{candidate.naem}}" out loud.
 */
export function splitTokens(
  template: string,
  fields?: PlaceholderField[]
): { known: PlaceholderField[]; unknown: string[] } {
  const known: PlaceholderField[] = [];
  const unknown: string[] = [];

  for (const token of extractTokens(template)) {
    const field = findPlaceholder(token, fields);
    if (field) known.push(field);
    else unknown.push(token);
  }

  return { known, unknown };
}

/** Values a script is rendered with. Missing keys fall back — see below. */
export type PlaceholderValues = Partial<Record<string, string | null>>;

/**
 * Substitutes tokens with real values.
 *
 * THE FALLBACK IS THE INTERESTING PART. Three cases, three behaviours:
 *
 *   - a known token with a value        -> the value
 *   - a known token with no value yet   -> `onMissing`, default "" (removed)
 *   - a token not in the catalogue      -> left EXACTLY as written
 *
 * The third is deliberate. Silently deleting `{{candidate.naem}}` would hide
 * the typo and produce a sentence with a hole in it that reads as fluent
 * English; leaving it visible means whoever reviews the rendered script sees
 * immediately what went wrong. Nothing reaches a candidate without that review
 * — see assertScriptIsCompliant in lib/screening/script.ts.
 */
export function renderTemplate(
  template: string,
  values: PlaceholderValues,
  { onMissing = "", fields }: { onMissing?: string; fields?: PlaceholderField[] } = {}
): string {
  const lookup = lookupFor(fields);

  return template.replace(TOKEN_PATTERN, (whole, rawToken: string) => {
    const token = rawToken.toLowerCase();
    if (!lookup.has(token)) return whole;

    const value = values[token];
    if (value === undefined || value === null || value === "") return onMissing;
    return value;
  });
}

/** Realistic values for every catalogued field, for "Preview with sample data". */
export function sampleValues(fields: PlaceholderField[] = PLACEHOLDER_FIELDS): PlaceholderValues {
  return Object.fromEntries(fields.map((field) => [field.token, field.sample]));
}

/**
 * The preview.
 *
 * Uses the same renderTemplate() the real run uses, rather than a separate
 * preview path — a preview that renders differently from production is worse
 * than no preview, because it is believed.
 */
export function renderPreview(
  template: string,
  fields: PlaceholderField[] = PLACEHOLDER_FIELDS
): string {
  return renderTemplate(template, sampleValues(fields), {
    fields,
    // Sample values cover every catalogued token, so this only fires for a
    // field added to the catalogue without a sample — visible, not silent.
    onMissing: "—",
  });
}

/**
 * Inserts a token into a script at the cursor.
 *
 * Returns the new text AND where the caret should end up, because leaving the
 * caret at position 0 after every insert (what happens if you only return the
 * string) makes inserting a second field maddening.
 *
 * Spacing is handled so tokens do not fuse with adjacent words: inserting into
 * "Hi,|" produces "Hi, {{candidate.name}}" rather than "Hi,{{candidate.name}}".
 */
export function insertToken({
  text,
  token,
  selectionStart,
  selectionEnd,
}: {
  text: string;
  token: string;
  selectionStart: number;
  selectionEnd: number;
}): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));

  const before = text.slice(0, start);
  const after = text.slice(end);

  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailingSpace = after.length > 0 && !/^[\s.,;:!?)]/.test(after);

  const piece = `${needsLeadingSpace ? " " : ""}${toToken(token)}${needsTrailingSpace ? " " : ""}`;

  return { text: `${before}${piece}${after}`, caret: start + piece.length };
}
