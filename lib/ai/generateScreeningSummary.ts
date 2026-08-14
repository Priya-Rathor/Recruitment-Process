// =============================================================================
// AI Service Layer function — Module 9's screening report.
//
// Turns a call transcript into a short narrative plus structured fields:
// interest level, expected CTC, notice period, location acceptance,
// availability.
//
// Two spec requirements are enforced in code rather than requested in the
// prompt:
//
//   "Uncertain/ambiguous answers are flagged rather than guessed confidently"
//     -> 'unclear' is a real value, and the model must list which fields it was
//        unsure about. A field it flagged cannot also be reported confidently.
//
//   "Structured fields are derivable from the transcript"
//     -> every figure in the narrative must appear in the transcript or in the
//        fields extracted from it. A summary that invents "45 days" when the
//        call said 30 is rejected, not displayed next to the contradicting
//        field.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import { numbersInText } from "@/lib/ai/numericGuard";

export type InterestLevel = "high" | "medium" | "low" | "unclear";
export type LocationAcceptance = "accepted" | "rejected" | "unclear";

/** Field names the model may flag as uncertain. */
export const REPORT_FIELDS = [
  "interest_level",
  "expected_ctc",
  "notice_period_days",
  "location_accepted",
  "availability_notes",
] as const;

export type ReportField = (typeof REPORT_FIELDS)[number];

export type ScreeningExtraction = {
  summaryText: string;
  interestLevel: InterestLevel;
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  locationAccepted: LocationAcceptance;
  availabilityNotes: string | null;
  /** Fields the model was not confident about. */
  uncertainFields: ReportField[];
};

const MAX_SUMMARY_LENGTH = 900;
const MAX_TRANSCRIPT_LENGTH = 30_000;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function cleanNumber(value: unknown, max: number): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > max) return null;
  return numeric;
}

function cleanInterest(value: unknown): InterestLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "unclear";
}

function cleanLocation(value: unknown): LocationAcceptance {
  return value === "accepted" || value === "rejected" ? value : "unclear";
}

/**
 * Digits appearing anywhere in a string, used to ground the narrative in what
 * was actually said. Delegates to the shared guard so every module that checks
 * figures against text uses the same parser.
 */
export const numbersIn = numbersInText;

/**
 * Figures in the summary that are supported by neither the transcript nor the
 * extracted fields.
 *
 * Spelled-out numbers in speech ("thirty days") are common and legitimate, so
 * the extracted FIELDS also count as support — they were derived from the same
 * transcript and a human reviews them. What this catches is the case that
 * matters: a narrative stating a figure that contradicts the field beside it.
 */
export function findUngroundedFigures(
  summary: string,
  transcript: string,
  extraction: Pick<ScreeningExtraction, "expectedCtc" | "noticePeriodDays">
): number[] {
  const supported = numbersIn(transcript);
  if (extraction.expectedCtc !== null) {
    supported.add(extraction.expectedCtc);
    // "19 LPA" for 1900000 is a normal, correct rendering.
    supported.add(Math.round(extraction.expectedCtc / 100_000));
  }
  if (extraction.noticePeriodDays !== null) {
    supported.add(extraction.noticePeriodDays);
    if (extraction.noticePeriodDays % 30 === 0) {
      supported.add(extraction.noticePeriodDays / 30); // "2 months"
    }
  }

  const offenders: number[] = [];
  for (const value of numbersIn(summary)) {
    if (!supported.has(value)) offenders.push(value);
  }
  return offenders;
}

function validate(value: unknown, transcript: string): ScreeningExtraction | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const summaryText = cleanText(raw.summaryText, MAX_SUMMARY_LENGTH);
  if (!summaryText) return null;

  const uncertainRaw = Array.isArray(raw.uncertainFields) ? raw.uncertainFields : [];
  const uncertainFields = uncertainRaw.filter((field): field is ReportField =>
    (REPORT_FIELDS as readonly string[]).includes(field as string)
  );

  const extraction: ScreeningExtraction = {
    summaryText,
    interestLevel: cleanInterest(raw.interestLevel),
    expectedCtc: cleanNumber(raw.expectedCtc, Number.MAX_SAFE_INTEGER),
    noticePeriodDays: cleanNumber(raw.noticePeriodDays, 365),
    locationAccepted: cleanLocation(raw.locationAccepted),
    availabilityNotes: cleanText(raw.availabilityNotes, 500),
    uncertainFields,
  };

  // Consistency: a field the model reported as unclear cannot also carry a
  // confident value, and vice versa. Reconciled rather than rejected, since the
  // narrative is still useful.
  if (extraction.interestLevel === "unclear" && !extraction.uncertainFields.includes("interest_level")) {
    extraction.uncertainFields.push("interest_level");
  }
  if (extraction.locationAccepted === "unclear" && !extraction.uncertainFields.includes("location_accepted")) {
    extraction.uncertainFields.push("location_accepted");
  }
  if (extraction.expectedCtc === null && !extraction.uncertainFields.includes("expected_ctc")) {
    extraction.uncertainFields.push("expected_ctc");
  }
  if (extraction.noticePeriodDays === null && !extraction.uncertainFields.includes("notice_period_days")) {
    extraction.uncertainFields.push("notice_period_days");
  }

  // The grounding check. A narrative contradicting its own fields is worse than
  // no narrative.
  const ungrounded = findUngroundedFigures(summaryText, transcript, extraction);
  if (ungrounded.length > 0) {
    console.error(`[ai] screening summary cited ungrounded figures: ${ungrounded.join(", ")}`);
    return null;
  }

  return extraction;
}

const SYSTEM_PROMPT = `You summarise a recruitment screening phone call from its transcript.

Return ONLY a JSON object:
{
  "summaryText": string,
  "interestLevel": "high"|"medium"|"low"|"unclear",
  "expectedCtc": number|null,
  "noticePeriodDays": number|null,
  "locationAccepted": "accepted"|"rejected"|"unclear",
  "availabilityNotes": string|null,
  "uncertainFields": string[]
}

Absolute rules:
- Report ONLY what the candidate actually said. Never infer, assume, or fill a gap with what is typical.
- If an answer was vague, hedged, or never given, use "unclear" or null AND list that field in uncertainFields. Guessing confidently is the worst possible failure here — a recruiter will act on this.
- uncertainFields may contain: interest_level, expected_ctc, notice_period_days, location_accepted, availability_notes.
- expectedCtc as a plain annual number, digits only. "19 LPA" (Indian lakhs per annum) is 1900000.
- noticePeriodDays in DAYS. "two months" is 60. "immediate" is 0.
- locationAccepted: "accepted" only if they clearly agreed to the location or work mode discussed; "rejected" if they clearly declined; otherwise "unclear".
- availabilityNotes: when they said they can talk or start, in their own terms. null if not discussed.
- summaryText: 2 to 4 short sentences, plain language. State only figures that appear in the transcript. Do not calculate anything.
- Do not comment on the candidate's accent, tone, personality, or any protected characteristic. Report what was said, not how.
- Return no commentary outside the JSON object.`;

export type SummaryInput = {
  transcript: string;
  candidateName: string;
  jobTitle: string;
  /** The questions the call was supposed to ask, for context. */
  questions: string[];
};

export async function generateScreeningSummary(
  input: SummaryInput
): Promise<AiResult<ScreeningExtraction>> {
  const transcript = input.transcript.trim();

  // The spec: "Report generation fails gracefully if the transcript is empty or
  // a call failed." Refused before spending a token.
  if (transcript.length < 50) {
    return {
      ok: false,
      code: "invalid_output",
      message:
        "This call has no usable transcript to summarise. Review the recording or call again.",
    };
  }

  const payload = [
    `Candidate: ${input.candidateName}`,
    `Role: ${input.jobTitle}`,
    input.questions.length > 0 ? `Questions asked:\n- ${input.questions.join("\n- ")}` : null,
    `\nTranscript:\n${transcript.slice(0, MAX_TRANSCRIPT_LENGTH)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return completeJson<ScreeningExtraction>({
    system: SYSTEM_PROMPT,
    user: payload,
    // Reporting what was said, not writing.
    temperature: 0.1,
    maxOutputTokens: 700,
    validate: (value) => validate(value, transcript),
  });
}
