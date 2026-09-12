// =============================================================================
// Documentation search — deliberately not a search engine.
//
// The spec for this module says it in as many words: "Do not build an
// unnecessarily complex search engine for the first version." So this is term
// matching over the parsed blocks, scored by where the term landed, with a
// snippet cut around the first hit. No index format, no stemmer, no dependency.
//
// It runs on the SERVER (app/api/docs/search) for two reasons. The whole corpus
// is ~350kB of text, which is not something to ship to a browser on every
// documentation page load — and role filtering has to happen somewhere the
// browser cannot skip. A snippet is a disclosure: matching an admin-only page
// and returning two lines of it would leak exactly what gating that page was
// for.
//
// Pure — the route hands it documents, it hands back hits. Unit tested.
// =============================================================================

export type SearchDocument = {
  slug: string;
  title: string;
  description: string;
  group: string;
  /** Every heading in the page, for a heading-level hit. */
  headings: string[];
  /** The page's full prose, already flattened. */
  text: string;
};

export type SearchHit = {
  slug: string;
  title: string;
  group: string;
  /** The heading the match sits under, when the match was in the body. */
  context: string | null;
  snippet: string;
  score: number;
};

/**
 * Scores, highest first. A title match beats a heading match beats a body
 * match, because somebody typing "pipeline" wants the Pipeline page rather than
 * the eleven pages that mention it.
 */
const TITLE_SCORE = 100;
const DESCRIPTION_SCORE = 40;
const HEADING_SCORE = 25;
const BODY_SCORE = 4;
const EXACT_ID_SCORE = 500;

/** Splits a query into the terms every hit must contain. */
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9/._-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

export function search(documents: SearchDocument[], query: string, limit = 20): SearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];

  for (const document of documents) {
    const title = document.title.toLowerCase();
    const description = document.description.toLowerCase();
    const body = document.text.toLowerCase();
    const headings = document.headings.map((heading) => heading.toLowerCase());

    // EVERY term must appear somewhere, so "pipeline sla" does not return every
    // page containing "pipeline". Two words is a narrowing, not a wish list.
    const matchesAll = terms.every(
      (term) =>
        title.includes(term) ||
        description.includes(term) ||
        body.includes(term) ||
        headings.some((heading) => heading.includes(term))
    );
    if (!matchesAll) continue;

    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += TITLE_SCORE;
      if (description.includes(term)) score += DESCRIPTION_SCORE;
      if (headings.some((heading) => heading.includes(term))) score += HEADING_SCORE;

      const occurrences = countOccurrences(body, term);
      score += Math.min(occurrences, 5) * BODY_SCORE;

      // A test case id or an endpoint typed in full is never a fuzzy request.
      if (/^(tc|ec|r)-[a-z0-9-]+$/i.test(term) && body.includes(term)) score += EXACT_ID_SCORE;
    }

    const { snippet, context } = excerpt(document, terms[0]);
    hits.push({ slug: document.slug, title: document.title, group: document.group, context, snippet, score });
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * ~180 characters around the first hit, cut on word boundaries.
 *
 * Falls back to the page description when the term only matched the title:
 * a snippet reading "…ipeline & SLA The board, stage move…" helps nobody.
 */
function excerpt(document: SearchDocument, term: string): { snippet: string; context: string | null } {
  const index = document.text.toLowerCase().indexOf(term);
  if (index === -1) return { snippet: document.description, context: null };

  const start = Math.max(0, index - 60);
  const end = Math.min(document.text.length, index + 120);
  const raw = document.text.slice(start, end).replace(/\s+/g, " ").trim();

  const context =
    document.headings.find((heading) => heading.toLowerCase().includes(term)) ?? null;

  return {
    snippet: `${start > 0 ? "…" : ""}${raw}${end < document.text.length ? "…" : ""}`,
    context,
  };
}
