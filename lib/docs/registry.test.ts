import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";
import { chapterText, splitChapters } from "./outline";
import { DOC_FILES, DOC_PAGES, findPage, type DocFileKey } from "./registry";
import { CROSS_CUTTING, MAP_STAGES } from "./systemMap";

/**
 * THE REGISTRY, ASSERTED AGAINST THE REAL DOCUMENTATION.
 *
 * app/settings/catalog.test.ts walks the app directory so a settings card can
 * never point at a page that does not exist. This is the same guard one level
 * up: the documentation centre's sidebar is generated from DOC_PAGES, and a
 * marker that no longer matches a chapter would render an empty page rather
 * than fail — the exact failure mode that lets a docs site rot in silence.
 *
 * It reads the actual markdown, not a fixture.
 */

const ROOT = process.cwd();

const CHAPTERS = new Map<DocFileKey, ReturnType<typeof splitChapters>>(
  (Object.keys(DOC_FILES) as DocFileKey[]).map((key) => [
    key,
    splitChapters(parseMarkdown(readFileSync(path.join(ROOT, DOC_FILES[key]), "utf8"))),
  ])
);

describe("documentation files", () => {
  it.each(Object.entries(DOC_FILES))("%s exists on disk", (_key, file) => {
    expect(existsSync(path.join(ROOT, file))).toBe(true);
  });
});

describe("every registry page resolves", () => {
  const sourced = DOC_PAGES.filter((page) => page.source !== null);

  it.each(sourced.map((page) => [page.slug, page] as const))(
    "%s matches exactly one chapter",
    (_slug, page) => {
      const chapters = CHAPTERS.get(page.source!.file);
      expect(chapters, `no such file key: ${page.source!.file}`).toBeDefined();

      const matches = chapters!.filter((chapter) => chapter.title.includes(page.source!.marker));

      // Exactly one. Zero is a renamed chapter; two means the marker is
      // ambiguous and findChapter would silently pick the first.
      expect(matches.map((chapter) => chapter.title)).toHaveLength(1);
    }
  );

  it("gives every matched chapter real content", () => {
    for (const page of sourced) {
      const chapter = CHAPTERS.get(page.source!.file)!.find((entry) =>
        entry.title.includes(page.source!.marker)
      )!;
      // Measured in text, not in blocks: §36 is three blocks, one of which is a
      // 60-line template inside a code fence.
      expect(chapterText(chapter.blocks).length, `${page.slug} is thin`).toBeGreaterThan(200);
    }
  });
});

describe("the registry itself", () => {
  it("has unique slugs", () => {
    const slugs = DOC_PAGES.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has exactly one home page", () => {
    expect(DOC_PAGES.filter((page) => page.slug === "")).toHaveLength(1);
  });

  it("links only to pages that exist", () => {
    for (const page of DOC_PAGES) {
      for (const slug of page.related ?? []) {
        expect(findPage(slug), `${page.slug} links to a missing page: ${slug}`).not.toBeNull();
      }
    }
  });

  it("gives every module a status and a description", () => {
    for (const page of DOC_PAGES.filter((entry) => entry.group === "modules")) {
      expect(page.status, `${page.slug} has no status`).toBeDefined();
      expect(page.description.length).toBeGreaterThan(20);
    }
  });

  it("points every module route at a real page directory", () => {
    for (const page of DOC_PAGES.filter((entry) => entry.group === "modules")) {
      for (const route of page.routes ?? []) {
        if (route === "—") continue;
        // "/jobs/[id]" -> app/jobs/[id]. A route that was renamed is a route a
        // reader would click and land on a 404.
        //
        // The marketing routes live inside the "(marketing)" route group, which
        // is a directory that does NOT appear in the URL — so both shapes are
        // accepted rather than special-casing the three routes that use it.
        const candidates =
          route === "/"
            ? [path.join(ROOT, "app", "(marketing)", "page.tsx")]
            : [
                path.join(ROOT, "app", route.slice(1)),
                path.join(ROOT, "app", "(marketing)", route.slice(1)),
              ];
        expect(
          candidates.some((candidate) => existsSync(candidate)),
          `${page.slug} names a missing route: ${route}`
        ).toBe(true);
      }
    }
  });
});

describe("the system map", () => {
  const nodes = [...MAP_STAGES.flatMap((stage) => stage.nodes), ...CROSS_CUTTING];

  it("has unique node ids", () => {
    const ids = nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens a real documentation page from every box", () => {
    for (const node of nodes) {
      expect(findPage(node.slug), `${node.id} points at ${node.slug}`).not.toBeNull();
    }
  });

  it("has no edge pointing at a node that does not exist", () => {
    const ids = new Set(nodes.map((node) => node.id));
    for (const node of nodes) {
      for (const target of node.feeds) {
        expect(ids.has(target), `${node.id} feeds a missing node: ${target}`).toBe(true);
      }
    }
  });
});
