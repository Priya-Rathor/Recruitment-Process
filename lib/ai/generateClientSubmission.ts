// =============================================================================
// AI Service Layer functions — Module 12's client-facing drafts.
//
// THIS OUTPUT LEAVES THE BUILDING. A submission summary describes a real person
// to a third party who will make a decision about their career. An invented
// "8 years of Kubernetes" is not a hallucination to shrug at — it is a
// misrepresentation of someone, sent to their prospective employer, in our
// customer's name.
//
// So the grounding here is the strictest in the product:
//   - the spec's test is "AI submission summaries never state facts absent from
//     the candidate/application record"
//   - every figure must trace to a supplied value
//   - every SKILL named must appear in the candidate's recorded skills
//   - sending is a separate, explicit human action (see the API layer); this
//     function only ever produces a draft
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import { findUnsupportedNumbers, numbersInText } from "@/lib/ai/numericGuard";

export type SubmissionFacts = {
  candidateName: string;
  jobTitle: string;
  clientName: string;
  currentRole: string | null;
  currentCompany: string | null;
  totalExperienceYears: number | null;
  /** The candidate's recorded skills. The ONLY skills the draft may name. */
  skills: string[];
  location: string | null;
  workMode: string | null;
  expectedSalary: number | null;
  noticePeriodDays: number | null;
  /** From the REVIEWED screening report only. */
  screeningSummary: string | null;
  /** Strong matches from Module 7. */
  strengths: string[];
};

export type SubmissionDraft = {
  /** The message a recruiter reviews and sends. */
  summary: string;
  /** Bullet highlights, each traceable to a supplied fact. */
  highlights: string[];
};

const MAX_SUMMARY_LENGTH = 1200;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function cleanList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const text = cleanText(item, 300);
    if (text) output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

/** Figures the draft may state. */
export function allowedSubmissionNumbers(facts: SubmissionFacts): Set<number> {
  const allowed = new Set<number>([0]);

  if (facts.totalExperienceYears !== null) {
    allowed.add(facts.totalExperienceYears);
    // "5.4 years" may reasonably be written "5" — but not "8".
    allowed.add(Math.floor(facts.totalExperienceYears));
    allowed.add(Math.round(facts.totalExperienceYears));
  }
  if (facts.noticePeriodDays !== null) {
    allowed.add(facts.noticePeriodDays);
    if (facts.noticePeriodDays % 30 === 0) allowed.add(facts.noticePeriodDays / 30);
  }
  if (facts.expectedSalary !== null) {
    allowed.add(facts.expectedSalary);
    allowed.add(Math.round(facts.expectedSalary / 100_000)); // "19 LPA"
  }

  for (const text of [...facts.skills, ...facts.strengths, facts.screeningSummary ?? ""]) {
    for (const value of numbersInText(text)) allowed.add(value);
  }

  return allowed;
}

/**
 * Skill-like words in the draft that the candidate's record does not contain.
 *
 * Checked because naming an unrecorded technology to a client is the most likely
 * and most damaging invention: it reads as a specific, verifiable claim, and the
 * candidate will be asked about it in an interview they were set up to fail.
 *
 * Deliberately conservative: it only flags capitalised or well-known technology
 * tokens, so ordinary prose is not policed.
 */
export function findUnsupportedSkills(text: string, recordedSkills: string[]): string[] {
  const recorded = new Set(
    recordedSkills.flatMap((skill) => [
      skill.toLowerCase(),
      // "Spring Boot" should license "Spring" and "Boot" appearing separately.
      ...skill.toLowerCase().split(/[\s/]+/),
    ])
  );

  // A conservative list of tokens that read as concrete technical claims.
  const TECH_PATTERN =
    /\b(?:Java|Python|Kotlin|Scala|Golang|Rust|Ruby|PHP|Swift|TypeScript|JavaScript|React|Angular|Vue|Node(?:\.js)?|Spring(?: Boot)?|Django|Flask|Rails|\.NET|AWS|Azure|GCP|Kubernetes|Docker|Terraform|Jenkins|Kafka|RabbitMQ|Redis|PostgreSQL|Postgres|MySQL|MongoDB|Cassandra|Elasticsearch|GraphQL|Hadoop|Spark|Snowflake|Tableau|PowerBI|Salesforce|SAP)\b/g;

  const offenders = new Set<string>();
  for (const match of text.match(TECH_PATTERN) ?? []) {
    if (!recorded.has(match.toLowerCase())) offenders.add(match);
  }

  return [...offenders];
}

function validateSubmission(value: unknown, facts: SubmissionFacts): SubmissionDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const summary = cleanText(raw.summary, MAX_SUMMARY_LENGTH);
  if (!summary) return null;

  const draft: SubmissionDraft = {
    summary,
    highlights: cleanList(raw.highlights, 6),
  };

  const allText = [draft.summary, ...draft.highlights].join("\n");

  // Gate 1: no invented figures.
  const ungroundedNumbers = findUnsupportedNumbers(allText, allowedSubmissionNumbers(facts));
  if (ungroundedNumbers.length > 0) {
    console.error(
      `[ai] client submission cited unsupported figures: ${ungroundedNumbers.join(", ")}`
    );
    return null;
  }

  // Gate 2: no invented skills. This is the one that would embarrass a client
  // and set up a candidate to fail an interview.
  const ungroundedSkills = findUnsupportedSkills(allText, facts.skills);
  if (ungroundedSkills.length > 0) {
    console.error(
      `[ai] client submission named unrecorded skills: ${ungroundedSkills.join(", ")}`
    );
    return null;
  }

  return draft;
}

const SUBMISSION_PROMPT = `You draft a short message introducing a candidate to a client company, for a recruiter to review and send.

Return ONLY a JSON object:
{ "summary": string, "highlights": string[] }

Absolute rules:
- State ONLY facts present in the input. This message is sent to a real client about a real person — an invented detail is a misrepresentation, and the candidate will be asked about it in an interview.
- Never name a technology, tool, or skill that is not in the candidate's listed skills.
- Never state a number that is not in the input. Do not estimate, round up, or infer years of experience.
- Do not editorialise about how good they are. Present what they have done and let the client judge. No "excellent", "outstanding", "perfect fit".
- Do not mention the candidate's age, gender, nationality, marital status, or any protected characteristic.
- summary: 3 to 5 sentences, professional and plain. Suitable to paste into an email.
- highlights: up to 5 short bullets, each a concrete fact from the input.
- Return no commentary outside the JSON object.`;

export async function generateClientSubmission(
  facts: SubmissionFacts
): Promise<AiResult<SubmissionDraft>> {
  // Nothing solid to say. Better to refuse than to send a client a paragraph of
  // padding about someone.
  if (facts.skills.length === 0 && facts.totalExperienceYears === null && !facts.screeningSummary) {
    return {
      ok: false,
      code: "invalid_output",
      message:
        "There isn't enough on this candidate's record to draft a submission. Add their skills and experience first.",
    };
  }

  const payload: Record<string, unknown> = {
    candidate: facts.candidateName,
    role: facts.jobTitle,
    client: facts.clientName,
    skills: facts.skills,
  };

  if (facts.currentRole) payload.currentRole = facts.currentRole;
  if (facts.currentCompany) payload.currentCompany = facts.currentCompany;
  if (facts.totalExperienceYears !== null) payload.totalExperienceYears = facts.totalExperienceYears;
  if (facts.location) payload.location = facts.location;
  if (facts.workMode) payload.workMode = facts.workMode;
  if (facts.expectedSalary !== null) payload.expectedSalary = facts.expectedSalary;
  if (facts.noticePeriodDays !== null) payload.noticePeriodDays = facts.noticePeriodDays;
  if (facts.screeningSummary) payload.screeningSummary = facts.screeningSummary;
  if (facts.strengths.length > 0) payload.strengths = facts.strengths;

  return completeJson<SubmissionDraft>({
    system: SUBMISSION_PROMPT,
    user: JSON.stringify(payload, null, 2),
    temperature: 0.2,
    maxOutputTokens: 800,
    validate: (value) => validateSubmission(value, facts),
  });
}

// =============================================================================
// Client activity summary — internal, for the account manager.
// =============================================================================

export type ActivityFacts = {
  clientName: string;
  activeJobs: number;
  submittedCandidates: number;
  awaitingFeedback: number;
  overdueFeedback: number;
  interviewsScheduled: number;
  averageResponseDays: number | null;
  feedbackSlaDays: number;
};

export type ActivitySummary = { summary: string };

export function allowedActivityNumbers(facts: ActivityFacts): Set<number> {
  const allowed = new Set<number>([
    0,
    facts.activeJobs,
    facts.submittedCandidates,
    facts.awaitingFeedback,
    facts.overdueFeedback,
    facts.interviewsScheduled,
    facts.feedbackSlaDays,
  ]);
  if (facts.averageResponseDays !== null) {
    allowed.add(facts.averageResponseDays);
    allowed.add(Math.round(facts.averageResponseDays));
  }
  return allowed;
}

const ACTIVITY_PROMPT = `You summarise a client relationship for the account manager who owns it.

Return ONLY a JSON object: { "summary": string }

Rules:
- State ONLY the figures given. Never calculate, total, or estimate a new one.
- Write numbers as digits.
- 2 to 3 sentences. Say where things stand and what needs chasing.
- This is internal. Be direct about a client who is slow to respond, but describe the behaviour, not the people.
- Return no commentary outside the JSON object.`;

export async function summarizeClientActivity(
  facts: ActivityFacts
): Promise<AiResult<ActivitySummary>> {
  const hasActivity =
    facts.activeJobs > 0 || facts.submittedCandidates > 0 || facts.interviewsScheduled > 0;

  if (!hasActivity) {
    // A real answer, and it costs nothing.
    return {
      ok: true,
      data: {
        summary: `There's no activity recorded for ${facts.clientName} yet. Jobs and submissions will appear here once they start.`,
      },
    };
  }

  const allowed = allowedActivityNumbers(facts);

  return completeJson<ActivitySummary>({
    system: ACTIVITY_PROMPT,
    user: JSON.stringify(facts, null, 2),
    temperature: 0.1,
    maxOutputTokens: 300,
    validate: (value) => {
      if (typeof value !== "object" || value === null) return null;
      const summary = cleanText((value as Record<string, unknown>).summary, 600);
      if (!summary) return null;

      const offenders = findUnsupportedNumbers(summary, allowed, {
        rejectUnlistedPercentages: true,
      });
      if (offenders.length > 0) {
        console.error(`[ai] client activity summary cited bad figures: ${offenders.join(", ")}`);
        return null;
      }

      return { summary };
    },
  });
}
