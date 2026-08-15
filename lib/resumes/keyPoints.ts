// =============================================================================
// A one-paragraph resume summary, composed from parsed fields.
//
// Module 6's parser never produced a prose summary — it extracts structured
// fields (role, company, experience, skills, certifications). The Evaluation
// panel asks for "the AI-parsed summary/key points", so this composes those
// points into a sentence rather than adding a column and a second AI call for
// something the data already answers.
//
// Deliberately NOT another LLM call. Every fact here is already validated
// structured output; running it back through a model would add latency, cost,
// and a chance of inventing a detail the resume never contained.
// =============================================================================
import type { ParsedResume } from "@/lib/ai/parseResume";

const MAX_SKILLS = 8;

/**
 * Key points, or null when the parse found too little to say anything.
 *
 * Null rather than an empty string: the caller renders "No parsed summary on
 * file", which is true, whereas a blank paragraph looks like a rendering fault.
 */
export function resumeKeyPoints(parsed: ParsedResume | null | undefined): string | null {
  if (!parsed) return null;

  const parts: string[] = [];

  const role = parsed.currentRole?.trim();
  const company = parsed.currentCompany?.trim();
  const years = parsed.totalExperienceYears;

  if (role && company) parts.push(`${role} at ${company}`);
  else if (role) parts.push(role);
  else if (company) parts.push(`Currently at ${company}`);

  if (years !== null && years !== undefined) {
    parts.push(`${years} year${years === 1 ? "" : "s"} of experience`);
  }

  if (parsed.location?.trim()) parts.push(`based in ${parsed.location.trim()}`);

  const opening = parts.length > 0 ? `${parts.join(", ")}.` : "";

  const skills = parsed.skills.slice(0, MAX_SKILLS);
  const skillLine =
    skills.length > 0
      ? `Skills: ${skills.join(", ")}${parsed.skills.length > MAX_SKILLS ? ", …" : ""}.`
      : "";

  const certifications =
    parsed.certifications.length > 0
      ? `Certifications: ${parsed.certifications.slice(0, 3).join(", ")}.`
      : "";

  // Experience count rather than the entries themselves — the full history is
  // one click away on the resume, and repeating it here would bury the summary.
  const historyLine =
    parsed.experience.length > 1
      ? `${parsed.experience.length} roles listed.`
      : "";

  const composed = [opening, skillLine, certifications, historyLine]
    .filter((line) => line.length > 0)
    .join(" ");

  return composed.length > 0 ? composed : null;
}
