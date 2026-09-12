// =============================================================================
// Pulling the manual test cases out of the documentation.
//
// The QA manual already carries 1,000-odd test cases in 25 tables, all with the
// same columns. The testing centre reads THOSE tables rather than holding a
// second list, because a QA tool whose cases have drifted from the documentation
// is worse than no tool: somebody tests the old behaviour and files the pass.
//
// Pure — takes parsed blocks, returns rows. Unit tested in testCases.test.ts.
// =============================================================================
import type { Block, Span } from "./markdown";
import { spansToText } from "./markdown";

export type TestCase = {
  id: string;
  /** The documentation page this came from, for the "open the docs" link. */
  pageSlug: string;
  moduleTitle: string;
  feature: string;
  scenario: string;
  steps: string;
  expected: string;
  priority: string;
};

/** Column headers we know how to read, lowercased. Order is not assumed. */
const COLUMNS: Record<string, keyof TestCase | undefined> = {
  "test case id": "id",
  feature: "feature",
  "test scenario": "scenario",
  steps: "steps",
  "steps to test": "steps",
  "expected result": "expected",
  priority: "priority",
};

/**
 * Every test case in one parsed chapter.
 *
 * A table is a test-case table when its first column is "Test Case ID" — the
 * chapters contain plenty of other tables (UI components, APIs, edge cases) and
 * matching on the heading above them would break the moment a heading is
 * renumbered.
 */
export function extractTestCases(
  blocks: Block[],
  pageSlug: string,
  moduleTitle: string
): TestCase[] {
  const cases: TestCase[] = [];

  for (const block of blocks) {
    if (block.kind !== "table") continue;

    const headers = block.head.map((cell) => spansToText(cell).trim().toLowerCase());
    if (headers[0] !== "test case id") continue;

    for (const row of block.rows) {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        const field = COLUMNS[header];
        if (field) record[field] = cellText(row[index]);
      });

      // A row with no id is a stray line, not a test case.
      if (!record.id) continue;

      cases.push({
        id: record.id,
        pageSlug,
        moduleTitle,
        feature: record.feature ?? "",
        scenario: record.scenario ?? "",
        steps: record.steps ?? "",
        expected: record.expected ?? "",
        priority: record.priority || "Unspecified",
      });
    }
  }

  return cases;
}

function cellText(cell: Span[] | undefined): string {
  return cell ? spansToText(cell).trim() : "";
}

/** Priority order for sorting and for the filter chips. */
export const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;

export function priorityRank(priority: string): number {
  const index = PRIORITIES.indexOf(priority as (typeof PRIORITIES)[number]);
  return index === -1 ? PRIORITIES.length : index;
}
