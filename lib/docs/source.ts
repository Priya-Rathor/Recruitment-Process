// =============================================================================
// Loading documentation content off disk. SERVER ONLY.
//
// The content of this module is the project's own docs/*.md — the same files a
// developer edits in a pull request. That is the whole maintenance argument for
// building it this way: there is no second copy of the documentation to keep in
// step, and updating a module's docs is editing the markdown, not editing React.
//
// TWO THINGS TO KNOW BEFORE CHANGING THIS FILE.
//
// 1. NO CALLER-SUPPLIED PATHS. A page names a key of DOC_FILES, never a path,
//    so there is nothing here to traverse. Do not add a function that takes a
//    filename — the URL segment would reach it in one refactor.
//
// 2. THE FILES MUST BE TRACED INTO THE DEPLOYMENT. next.config.ts declares
//    `outputFileTracingIncludes` for the /docs routes; without it the markdown
//    is left behind on Vercel and every documentation page 404s in production
//    while working perfectly on a developer's machine. That entry is not
//    optional decoration.
// =============================================================================
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DOC_FILES, type DocFileKey } from "./registry";
import { parseMarkdown, type Block } from "./markdown";
import { splitChapters, type Chapter } from "./outline";

/**
 * Parsed documents, cached for the life of the server process.
 *
 * The markdown is static — it changes when someone deploys, not when someone
 * clicks — so parsing 6,400 lines on every request would be pure waste. In dev
 * the process restarts on edit, so a writer still sees their change.
 */
const cache = new Map<DocFileKey, Chapter[]>();

export async function loadChapters(key: DocFileKey): Promise<Chapter[]> {
  const cached = cache.get(key);
  if (cached) return cached;

  const absolute = path.join(process.cwd(), DOC_FILES[key]);
  const source = await readFile(absolute, "utf8");
  const chapters = splitChapters(parseMarkdown(source));

  cache.set(key, chapters);
  return chapters;
}

export type LoadedPage = { title: string; blocks: Block[] };

/**
 * The content behind one registry entry, or null when the chapter has gone.
 *
 * NULL RATHER THAN A THROW, and rather than an empty page. A marker that stops
 * matching means somebody renamed a chapter; the route turns this into a 404
 * and registry.test.ts turns it into a failing test on the next run, which is
 * the pair of behaviours that keeps a stale sidebar from looking fine.
 */
export async function loadPage(
  source: { file: DocFileKey; marker: string }
): Promise<LoadedPage | null> {
  const chapters = await loadChapters(source.file);
  const chapter = chapters.find((entry) => entry.title.includes(source.marker));
  if (!chapter) return null;
  return { title: chapter.displayTitle, blocks: chapter.blocks };
}
