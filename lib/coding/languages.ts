// =============================================================================
// The languages a coding round can offer.
//
// A CLOSED LIST, like every other vocabulary in this codebase. A free-text
// language column would store "pyhton" cleanly and then fail to highlight, and
// the candidate would spend the first two minutes of a timed test wondering
// whether the editor was broken.
//
// Deliberately five, and deliberately these five. Each one has a maintained
// CodeMirror 6 grammar, which is the actual constraint: offering a language the
// editor cannot highlight is worse than not offering it, because the candidate
// reads the missing colour as "this tool does not really support my language"
// at exactly the moment they need to trust it.
//
// NO EXECUTION. Nothing here runs code — see docs/live-coding-interview.md.
// The list is about editing and reading, not about a sandbox this product does
// not have.
// =============================================================================

export const CODING_LANGUAGES = ["python", "javascript", "java", "cpp", "sql"] as const;

export type CodingLanguage = (typeof CODING_LANGUAGES)[number];

export function isCodingLanguage(value: unknown): value is CodingLanguage {
  return typeof value === "string" && (CODING_LANGUAGES as readonly string[]).includes(value);
}

export const LANGUAGE_LABELS: Record<CodingLanguage, string> = {
  python: "Python",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
  sql: "SQL",
};

/**
 * What the editor contains when the candidate first opens it.
 *
 * NOT an empty buffer. A blank editor asks someone under time pressure to
 * invent both the answer and the shape of the answer; a stub says "write here"
 * without hinting at a solution. Each one is deliberately trivial — a signature
 * and a hole — so it cannot be mistaken for a partial answer.
 */
export const LANGUAGE_STARTERS: Record<CodingLanguage, string> = {
  python: `def solution():\n    # Write your solution here\n    pass\n`,
  javascript: `function solution() {\n  // Write your solution here\n}\n`,
  java: `class Solution {\n    public void solution() {\n        // Write your solution here\n    }\n}\n`,
  cpp: `#include <iostream>\n\nint solution() {\n    // Write your solution here\n    return 0;\n}\n`,
  sql: `-- Write your query here\nSELECT 1;\n`,
};

/**
 * Narrows an arbitrary list to real languages, preserving order and dropping
 * duplicates.
 *
 * Returns the full list when nothing valid survives rather than an empty one:
 * a session whose language array was somehow emptied must still be answerable,
 * and a selector with no options is a dead end a candidate cannot escape.
 */
export function normalizeLanguages(value: unknown): CodingLanguage[] {
  if (!Array.isArray(value)) return [...CODING_LANGUAGES];

  const seen = new Set<CodingLanguage>();
  for (const item of value) {
    if (isCodingLanguage(item)) seen.add(item);
  }

  return seen.size > 0 ? [...seen] : [...CODING_LANGUAGES];
}

/** The language a session opens on. First offered, falling back to Python. */
export function defaultLanguage(languages: CodingLanguage[]): CodingLanguage {
  return languages[0] ?? "python";
}
