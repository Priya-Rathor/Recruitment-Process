// =============================================================================
// A markdown parser for the documentation centre — deliberately small.
//
// WHY NOT A LIBRARY. This project has no markdown dependency and the code
// quality rules say not to add one for trivial functionality. This is not quite
// trivial, but it is bounded: the only markdown this ever sees is the project's
// own docs/*.md, and a survey of every construct they actually use came back as
// headings, paragraphs, ordered/unordered/task lists, pipe tables, fenced code,
// blockquotes and rules. No nested lists, no images, no inline HTML, no
// footnotes. react-markdown + remark-gfm would be ~140kB to render seven shapes.
//
// IT RETURNS TYPED BLOCKS, NOT HTML. The renderer turns these into React
// elements, so there is no dangerouslySetInnerHTML anywhere in this module and a
// parser bug cannot become an injection. The audit lists "no
// dangerouslySetInnerHTML" as a property of this codebase; rendering docs was
// the obvious place to lose it.
//
// Pure — no fs, no React, no database. Client-safe by construction, and unit
// tested in markdown.test.ts.
// =============================================================================

export type Span = {
  text: string;
  code?: true;
  bold?: true;
  italic?: true;
  /** Set for [text](href). Relative hrefs are links inside the docs centre. */
  href?: string;
};

export type ListItem = {
  spans: Span[];
  /** null for a plain bullet; true/false for a `- [x]` / `- [ ]` task item. */
  checked: boolean | null;
};

export type Block =
  | { kind: "heading"; level: number; text: string; id: string; spans: Span[] }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "table"; head: Span[][]; rows: Span[][][] }
  | { kind: "code"; text: string; lang: string | null }
  | { kind: "quote"; spans: Span[] }
  | { kind: "rule" };

/**
 * A heading's anchor id.
 *
 * Lowercase, alphanumerics and dashes only. `§4.8 Test Cases` becomes
 * `4-8-test-cases`, which is stable across edits to the prose beneath it but
 * NOT across a rename of the heading itself — acceptable, because a renamed
 * heading is a changed anchor in every documentation tool.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

// Inline markers, longest-first so `**` is tried before `*`. Code is matched
// first in the alternation because backticks suppress every other marker
// inside them — `**not bold**` in code has to survive verbatim.
const INLINE = /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_|\[([^\]]+)\]\(([^)\s]+)\)/;

/** Parses one line of inline markdown into styled spans. */
export function parseInline(source: string): Span[] {
  const spans: Span[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      push(spans, { text: rest });
      break;
    }

    if (match.index > 0) push(spans, { text: rest.slice(0, match.index) });

    if (match[2] !== undefined) push(spans, { text: match[2].trim(), code: true });
    else if (match[3] !== undefined) push(spans, { text: match[3], bold: true });
    else if (match[4] !== undefined) push(spans, { text: match[4], bold: true });
    else if (match[5] !== undefined) push(spans, { text: match[5], italic: true });
    else if (match[6] !== undefined) push(spans, { text: match[6], italic: true });
    else if (match[7] !== undefined) push(spans, { text: match[7], href: match[8] });

    rest = rest.slice(match.index + match[0].length);
  }

  return spans.length > 0 ? spans : [{ text: "" }];
}

/** Drops empty spans and unescapes the two characters tables need escaped. */
function push(spans: Span[], span: Span) {
  const text = span.text.replace(/\\([|*_`])/g, "$1");
  if (text.length === 0) return;
  spans.push({ ...span, text });
}

/** The plain text of a run of spans — used for anchors, search and the TOC. */
export function spansToText(spans: Span[]): string {
  return spans.map((span) => span.text).join("");
}

function splitRow(line: string): string[] {
  // Split on unescaped pipes only, then drop the empty cells the leading and
  // trailing pipes produce.
  const cells = line.split(/(?<!\\)\|/);
  if (cells.length > 0 && cells[0].trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

const DELIMITER_ROW = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const usedIds = new Map<string, number>();

  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ---- fenced code -----------------------------------------------------
    const fence = /^\s*```+\s*(\S*)\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", text: body.join("\n"), lang: fence[1] || null });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    // ---- rule ------------------------------------------------------------
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    // ---- heading ---------------------------------------------------------
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const spans = parseInline(heading[2].trim());
      const text = spansToText(spans);
      // Duplicate headings exist across a long document ("Purpose" appears in
      // every chapter), so an anchor gets a suffix rather than colliding.
      const base = slugify(text);
      const seen = usedIds.get(base) ?? 0;
      usedIds.set(base, seen + 1);
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text,
        id: seen === 0 ? base : `${base}-${seen + 1}`,
        spans,
      });
      continue;
    }

    // ---- table -----------------------------------------------------------
    if (line.trim().startsWith("|") && i + 1 < lines.length && DELIMITER_ROW.test(lines[i + 1])) {
      flushParagraph();
      const head = splitRow(line).map(parseInline);
      const rows: Span[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    // ---- blockquote ------------------------------------------------------
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      i--;
      blocks.push({
        kind: "quote",
        spans: parseInline(body.filter((entry) => entry.trim() !== "").join(" ")),
      });
      continue;
    }

    // ---- list ------------------------------------------------------------
    const bullet = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const ordered = /\d/.test(bullet[1]);
      const items: ListItem[] = [];
      // Continuation lines are indented and belong to the item above; a blank
      // line ends the list. Known Risks items wrap onto three lines, so losing
      // this would truncate half of every risk in the document.
      while (i < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (next && /\d/.test(next[1]) === ordered) {
          const content = next[2];
          const task = /^\[([ xX])\]\s*(.*)$/.exec(content);
          items.push({
            spans: parseInline(task ? task[2] : content),
            checked: task ? task[1].toLowerCase() === "x" : null,
          });
          i++;
        } else if (items.length > 0 && /^\s+\S/.test(lines[i])) {
          const previous = items[items.length - 1];
          previous.spans = parseInline(
            `${spansToTextWithMarkers(previous.spans)} ${lines[i].trim()}`
          );
          i++;
        } else {
          break;
        }
      }
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/**
 * Re-serialises spans so a wrapped list item can be re-parsed as one string.
 *
 * Needed because the continuation line arrives as raw markdown while the item
 * so far is already parsed; re-emitting the markers is cheaper and less
 * error-prone than merging two span arrays whose styles may straddle the join.
 */
function spansToTextWithMarkers(spans: Span[]): string {
  return spans
    .map((span) => {
      if (span.code) return `\`${span.text}\``;
      if (span.bold) return `**${span.text}**`;
      if (span.italic) return `*${span.text}*`;
      if (span.href) return `[${span.text}](${span.href})`;
      return span.text;
    })
    .join("");
}
