import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, slugify, spansToText, type Block } from "./markdown";

function kinds(blocks: Block[]) {
  return blocks.map((block) => block.kind);
}

describe("slugify", () => {
  it("makes a URL-safe anchor", () => {
    expect(slugify("4.8 Test Cases")).toBe("4-8-test-cases");
  });

  it("strips inline markers so the anchor matches what a reader sees", () => {
    expect(slugify("`/login` and **signup**")).toBe("login-and-signup");
  });

  it("never returns an empty id", () => {
    expect(slugify("———")).toBe("section");
  });
});

describe("parseInline", () => {
  it("reads bold, italic and code", () => {
    const spans = parseInline("A **bold** and `code` and *slanted* run");
    expect(spans.find((span) => span.bold)?.text).toBe("bold");
    expect(spans.find((span) => span.code)?.text).toBe("code");
    expect(spans.find((span) => span.italic)?.text).toBe("slanted");
  });

  it("does not read markers inside code", () => {
    const spans = parseInline("`**not bold**`");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ text: "**not bold**", code: true });
  });

  it("reads links", () => {
    const spans = parseInline("see [the guide](/docs/overview) first");
    expect(spans.find((span) => span.href)).toMatchObject({
      text: "the guide",
      href: "/docs/overview",
    });
  });

  it("unescapes the pipe a table cell had to escape", () => {
    expect(spansToText(parseInline("a \\| b"))).toBe("a | b");
  });
});

describe("parseMarkdown", () => {
  it("reads headings with unique anchors", () => {
    const blocks = parseMarkdown("# One\n\n## Purpose\n\n## Purpose\n");
    const headings = blocks.filter((block) => block.kind === "heading");
    expect(headings.map((heading) => heading.id)).toEqual(["one", "purpose", "purpose-2"]);
  });

  it("keeps a fenced block verbatim, markers and all", () => {
    const blocks = parseMarkdown("```\nStep 1  a | b\nStep 2  **kept**\n```\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "code",
      text: "Step 1  a | b\nStep 2  **kept**",
    });
  });

  it("does not treat a heading inside a fence as a heading", () => {
    const blocks = parseMarkdown("```\n# not a heading\n```\n");
    expect(kinds(blocks)).toEqual(["code"]);
  });

  it("reads a pipe table with its header row", () => {
    const blocks = parseMarkdown(
      "| ID | Result |\n| --- | --- |\n| TC-1 | Passes |\n| TC-2 | Fails |\n"
    );
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    if (table.kind !== "table") throw new Error("expected a table");
    expect(table.head.map(spansToText)).toEqual(["ID", "Result"]);
    expect(table.rows).toHaveLength(2);
    expect(spansToText(table.rows[1][0])).toBe("TC-2");
  });

  it("keeps empty cells, which the Actual/Status columns always are", () => {
    const blocks = parseMarkdown("| A | B | C |\n| --- | --- | --- |\n| x |  |  |\n");
    const table = blocks[0];
    if (table.kind !== "table") throw new Error("expected a table");
    expect(table.rows[0]).toHaveLength(3);
    expect(spansToText(table.rows[0][1])).toBe("");
  });

  it("reads task lists as checkable items", () => {
    const blocks = parseMarkdown("- [ ] not yet\n- [x] done\n");
    const list = blocks[0];
    if (list.kind !== "list") throw new Error("expected a list");
    expect(list.items.map((item) => item.checked)).toEqual([false, true]);
    expect(spansToText(list.items[0].spans)).toBe("not yet");
  });

  it("joins a wrapped list item instead of truncating it", () => {
    const blocks = parseMarkdown(
      "1. **Signup errors are not genericised.** `SignupForm` renders\n   the message verbatim.\n"
    );
    const list = blocks[0];
    if (list.kind !== "list") throw new Error("expected a list");
    expect(list.items).toHaveLength(1);
    expect(spansToText(list.items[0].spans)).toContain("the message verbatim.");
  });

  it("separates an ordered list from an unordered one", () => {
    const blocks = parseMarkdown("- a\n- b\n\n1. one\n2. two\n");
    const lists = blocks.filter((block) => block.kind === "list");
    expect(lists).toHaveLength(2);
    expect(lists.map((list) => (list.kind === "list" ? list.ordered : null))).toEqual([false, true]);
  });

  it("joins a wrapped paragraph into one block", () => {
    const blocks = parseMarkdown("Gets a real human into a real\nworkspace, and keeps everyone else out.\n");
    expect(blocks).toHaveLength(1);
    expect(spansToText((blocks[0] as Extract<Block, { kind: "paragraph" }>).spans)).toBe(
      "Gets a real human into a real workspace, and keeps everyone else out."
    );
  });

  it("reads a blockquote and a rule", () => {
    const blocks = parseMarkdown("> **Generated** by static analysis.\n> Second line.\n\n---\n");
    expect(kinds(blocks)).toEqual(["quote", "rule"]);
    expect(spansToText((blocks[0] as Extract<Block, { kind: "quote" }>).spans)).toContain(
      "Second line."
    );
  });
});
