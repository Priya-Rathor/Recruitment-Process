// =============================================================================
// Turning one long markdown file into navigable pages.
//
// The source documents are chapter-structured: docs/QA-MANUAL-TESTING-GUIDE.md
// is 6,400 lines whose level-1 headings are "# 4. MODULE M01 — Authentication &
// Session" and so on. A documentation centre that rendered that as one page
// would be a 6,400-line page, so it is split at level-1 headings and each
// chapter becomes a page.
//
// Pure — imported by the server pages, the search index and the tests alike.
// =============================================================================
import type { Block } from "./markdown";

export type Chapter = {
  /** The level-1 heading, verbatim: "4. MODULE M01 — Authentication & Session". */
  title: string;
  /** The same with its leading section number removed, for display. */
  displayTitle: string;
  blocks: Block[];
};

export type TocEntry = { id: string; text: string; level: number };

/**
 * Splits a parsed document at its level-1 headings.
 *
 * Anything before the first level-1 heading (a document's own title block and
 * its preamble) is returned as the first chapter, so nothing is silently lost.
 */
export function splitChapters(blocks: Block[]): Chapter[] {
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;

  for (const block of blocks) {
    if (block.kind === "heading" && block.level === 1) {
      current = { title: block.text, displayTitle: stripSectionNumber(block.text), blocks: [] };
      chapters.push(current);
      continue;
    }
    if (!current) {
      current = { title: "", displayTitle: "", blocks: [] };
      chapters.push(current);
    }
    current.blocks.push(block);
  }

  return chapters;
}

/**
 * "4. MODULE M01 — Authentication & Session" -> "MODULE M01 — Authentication &
 * Session". The numbers are the markdown file's own ordering and mean nothing
 * once the chapters are pages in a sidebar; worse, they go stale the moment a
 * chapter is inserted, so they are never displayed.
 */
export function stripSectionNumber(title: string): string {
  return title.replace(/^\d+(\.\d+)*\.?\s+/, "");
}

/**
 * Finds the chapter whose title contains `marker`.
 *
 * MATCHING ON A MARKER, NOT AN INDEX. The registry says a page is "MODULE M12",
 * not "chapter 15". An index breaks the moment somebody inserts a chapter —
 * silently, by showing the wrong module's documentation — whereas a marker that
 * stops matching fails loudly in registry.test.ts.
 */
export function findChapter(chapters: Chapter[], marker: string): Chapter | null {
  return chapters.find((chapter) => chapter.title.includes(marker)) ?? null;
}

/** The "On this page" rail: level-2 and level-3 headings, in document order. */
export function tableOfContents(blocks: Block[]): TocEntry[] {
  return blocks
    .filter((block): block is Extract<Block, { kind: "heading" }> => block.kind === "heading")
    .filter((block) => block.level === 2 || block.level === 3)
    .map((block) => ({ id: block.id, text: stripSectionNumber(block.text), level: block.level }));
}

/** Every word of prose in a chapter, for the search index. */
export function chapterText(blocks: Block[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        parts.push(block.text);
        break;
      case "paragraph":
      case "quote":
        parts.push(block.spans.map((span) => span.text).join(""));
        break;
      case "list":
        for (const item of block.items) parts.push(item.spans.map((span) => span.text).join(""));
        break;
      case "table": {
        for (const cell of [...block.head, ...block.rows.flat()]) {
          parts.push(cell.map((span) => span.text).join(""));
        }
        break;
      }
      case "code":
        parts.push(block.text);
        break;
      case "rule":
        break;
    }
  }

  return parts.join("\n");
}
