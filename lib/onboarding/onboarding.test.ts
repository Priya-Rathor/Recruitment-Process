// =============================================================================
// Module 19 tests.
//
// The spec's list, in order, plus the two things that would be silently wrong:
// the SQL seed drifting from the TypeScript copy, and the reminder sweep firing
// on documents that are somebody else's turn.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockerSummary,
  checklistProgress,
  completionCheck,
  documentActions,
  daysWaiting,
  groupedForDisplay,
  overduePendingDocuments,
  type ChecklistDocument,
} from "@/lib/onboarding/documents";
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  orderingFromIds,
  validateTemplate,
} from "@/lib/onboarding/templates";
import { sortOnboardingRecords } from "@/lib/onboarding/queries";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/0026_module19_onboarding_documents.sql"),
  "utf8"
);

function doc(over: Partial<ChecklistDocument> = {}): ChecklistDocument {
  return { id: "d1", name: "PAN Card", required: true, status: "pending", ...over };
}

// -----------------------------------------------------------------------------
describe("the completion gate", () => {
  it("blocks while a required document is not verified", () => {
    const check = completionCheck([
      doc({ id: "a", name: "PAN Card", status: "verified" }),
      doc({ id: "b", name: "Signed Offer Letter", status: "uploaded" }),
    ]);

    expect(check.canComplete).toBe(false);
    expect(check.blockers.map((b) => b.name)).toEqual(["Signed Offer Letter"]);
  });

  it("unblocks once every required document is verified", () => {
    const check = completionCheck([
      doc({ id: "a", status: "verified" }),
      doc({ id: "b", name: "Signed Offer Letter", status: "verified" }),
    ]);

    expect(check.canComplete).toBe(true);
    expect(check.blockers).toEqual([]);
  });

  it("does not let an optional document block completion", () => {
    // The whole reason optional exists: a first-time employee has no relieving
    // letter, and their onboarding must still be able to finish.
    const check = completionCheck([
      doc({ id: "a", status: "verified" }),
      doc({ id: "b", name: "Relieving Letter", required: false, status: "pending" }),
    ]);

    expect(check.canComplete).toBe(true);
  });

  it("treats an UPLOADED required document as still blocking", () => {
    // Uploaded is not checked. This is the case where a loose gate would mark
    // someone onboarded on the strength of a file nobody looked at.
    expect(completionCheck([doc({ status: "uploaded" })]).canComplete).toBe(false);
  });

  it("treats a REJECTED required document as still blocking", () => {
    expect(completionCheck([doc({ status: "rejected" })]).canComplete).toBe(false);
  });

  it("allows completion when there is no checklist at all", () => {
    // An org with no templates configured. Nothing is outstanding, so nothing
    // should be blocked — the detail page says the checklist is empty instead.
    expect(completionCheck([]).canComplete).toBe(true);
  });

  it("names what is missing, and stops naming after three", () => {
    expect(blockerSummary([])).toBeNull();
    expect(blockerSummary([{ id: "a", name: "PAN Card", status: "pending" }])).toBe(
      "PAN Card is not verified yet."
    );

    const many = ["A", "B", "C", "D", "E"].map((name) => ({
      id: name,
      name,
      status: "pending" as const,
    }));
    expect(blockerSummary(many)).toBe("A, B, C and 2 more are not verified yet.");
  });
});

// -----------------------------------------------------------------------------
describe("progress", () => {
  it("counts required and total separately", () => {
    const progress = checklistProgress([
      doc({ id: "a", status: "verified" }),
      doc({ id: "b", status: "verified" }),
      doc({ id: "c", status: "pending" }),
      doc({ id: "d", required: false, status: "verified" }),
    ]);

    expect(progress.requiredTotal).toBe(3);
    expect(progress.requiredVerified).toBe(2);
    expect(progress.total).toBe(4);
    expect(progress.verified).toBe(3);
    expect(progress.percent).toBe(67);
  });

  it("does not let optional documents move the bar", () => {
    const before = checklistProgress([doc({ status: "pending" })]);
    const after = checklistProgress([
      doc({ status: "pending" }),
      doc({ id: "opt", required: false, status: "verified" }),
    ]);

    expect(after.percent).toBe(before.percent);
  });

  it("reads an empty checklist as complete, not as zero", () => {
    expect(checklistProgress([]).percent).toBe(100);
  });
});

// -----------------------------------------------------------------------------
describe("who may do what to a document", () => {
  const RECRUITER = { canManage: true, canVerify: false };
  const ADMIN = { canManage: true, canVerify: true };

  it("refuses verify and reject to a recruiter", () => {
    const actions = documentActions({ status: "uploaded", ...RECRUITER });
    expect(actions.canVerify).toBe(false);
    expect(actions.canReject).toBe(false);
    // They can still upload — that is their half of the job.
    expect(actions.canUpload).toBe(true);
  });

  it("offers verify and reject to an admin on an uploaded document", () => {
    const actions = documentActions({ status: "uploaded", ...ADMIN });
    expect(actions.canVerify).toBe(true);
    expect(actions.canReject).toBe(true);
  });

  it("does not offer reject on a document nobody has uploaded", () => {
    expect(documentActions({ status: "pending", ...ADMIN }).canReject).toBe(false);
  });

  it("allows re-upload after a rejection", () => {
    expect(documentActions({ status: "rejected", ...RECRUITER }).canUpload).toBe(true);
  });

  it("does not allow replacing a verified document in place", () => {
    expect(documentActions({ status: "verified", ...ADMIN }).canUpload).toBe(false);
  });

  it("gives a viewer nothing but the file", () => {
    const actions = documentActions({ status: "uploaded", canManage: false, canVerify: false });
    expect(actions).toEqual({
      canUpload: false,
      canVerify: false,
      canReject: false,
      canView: true,
    });
  });
});

// -----------------------------------------------------------------------------
describe("display grouping", () => {
  it("puts required first and orders each group by display_order", () => {
    const { required, optional } = groupedForDisplay([
      { name: "Opt B", required: false, display_order: 9 },
      { name: "Req B", required: true, display_order: 2 },
      { name: "Opt A", required: false, display_order: 1 },
      { name: "Req A", required: true, display_order: 1 },
    ]);

    expect(required.map((r) => r.name)).toEqual(["Req A", "Req B"]);
    expect(optional.map((r) => r.name)).toEqual(["Opt A", "Opt B"]);
  });

  it("does not mutate its input", () => {
    const input = [
      { name: "B", required: true, display_order: 2 },
      { name: "A", required: true, display_order: 1 },
    ];
    groupedForDisplay(input);
    expect(input.map((r) => r.name)).toEqual(["B", "A"]);
  });
});

// -----------------------------------------------------------------------------
describe("list ordering", () => {
  it("surfaces in-progress first, oldest start first", () => {
    const sorted = sortOnboardingRecords([
      { status: "completed", started_at: "2026-01-01T00:00:00Z" },
      { status: "in_progress", started_at: "2026-06-01T00:00:00Z" },
      { status: "on_hold", started_at: "2026-02-01T00:00:00Z" },
      { status: "in_progress", started_at: "2026-03-01T00:00:00Z" },
    ]);

    expect(sorted.map((r) => `${r.status}:${r.started_at.slice(0, 7)}`)).toEqual([
      "in_progress:2026-03",
      "in_progress:2026-06",
      "on_hold:2026-02",
      "completed:2026-01",
    ]);
  });
});

// -----------------------------------------------------------------------------
describe("the pending-document reminder sweep", () => {
  const NOW = new Date("2026-08-18T09:00:00Z");

  const rows = [
    { id: "old-required", name: "PAN", required: true, status: "pending" as const, created_at: "2026-08-10T09:00:00Z" },
    { id: "new-required", name: "Bank", required: true, status: "pending" as const, created_at: "2026-08-17T09:00:00Z" },
    { id: "old-optional", name: "Relieving", required: false, status: "pending" as const, created_at: "2026-08-01T09:00:00Z" },
    { id: "old-uploaded", name: "Aadhaar", required: true, status: "uploaded" as const, created_at: "2026-08-01T09:00:00Z" },
  ];

  it("reminds only about required documents still pending past the window", () => {
    const overdue = overduePendingDocuments({ documents: rows, reminderDays: 3, now: NOW });
    expect(overdue.map((r) => r.id)).toEqual(["old-required"]);
  });

  it("sends nothing when the window is zero", () => {
    // 0 means "off". A sweep that treated it as "remind about everything" would
    // spam the whole team the first time somebody cleared the field.
    expect(overduePendingDocuments({ documents: rows, reminderDays: 0, now: NOW })).toEqual([]);
  });

  it("counts whole days waited", () => {
    expect(daysWaiting("2026-08-15T09:00:00Z", NOW)).toBe(3);
    expect(daysWaiting("2026-08-15T10:00:00Z", NOW)).toBe(2);
    expect(daysWaiting("not a date", NOW)).toBe(0);
  });
});

// -----------------------------------------------------------------------------
describe("template validation", () => {
  const VALID = { name: "PAN Card", expected_from: "candidate", required: true, active: true };

  it("accepts a complete template and trims the name", () => {
    const result = validateTemplate({ ...VALID, name: "  PAN Card  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("PAN Card");
  });

  it("refuses a blank name", () => {
    expect(validateTemplate({ ...VALID, name: "   " }).ok).toBe(false);
  });

  it("refuses an owner it does not recognise", () => {
    expect(validateTemplate({ ...VALID, expected_from: "hr_department" }).ok).toBe(false);
  });

  it("defaults required and active when the form omits them", () => {
    const result = validateTemplate({ name: "X", expected_from: "recruiter" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.required).toBe(true);
      expect(result.value.active).toBe(true);
    }
  });

  it("normalises an empty description to null rather than an empty string", () => {
    const result = validateTemplate({ ...VALID, description: "  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeNull();
  });

  it("renumbers a reordering contiguously from 1", () => {
    expect(orderingFromIds(["c", "a", "b"])).toEqual([
      { id: "c", display_order: 1 },
      { id: "a", display_order: 2 },
      { id: "b", display_order: 3 },
    ]);
  });
});

// -----------------------------------------------------------------------------
describe("the default checklist", () => {
  it("matches the spec's seven document types", () => {
    expect(DEFAULT_DOCUMENT_TEMPLATES).toHaveLength(7);
    expect(DEFAULT_DOCUMENT_TEMPLATES.map((t) => t.name).sort()).toEqual(
      [
        "Aadhaar / Government ID",
        "Background Verification Consent",
        "Bank Account Details",
        "Educational Certificates",
        "PAN Card",
        "Previous Employment Relieving Letter",
        "Signed Offer Letter",
      ].sort()
    );
  });

  it("marks only the relieving letter optional", () => {
    const optional = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !t.required).map((t) => t.name);
    expect(optional).toEqual(["Previous Employment Relieving Letter"]);
  });

  it("expects the offer letter from the recruiter and the rest from the candidate", () => {
    const byRecruiter = DEFAULT_DOCUMENT_TEMPLATES.filter(
      (t) => t.expected_from === "recruiter"
    ).map((t) => t.name);
    expect(byRecruiter).toEqual(["Signed Offer Letter"]);
  });

  it("does not drift from the SQL seed", () => {
    // The defaults exist twice — in seed_default_document_templates() and in
    // TypeScript. This is the guard that keeps the duplicate honest: every name,
    // its required flag and its owner must appear in the migration.
    for (const template of DEFAULT_DOCUMENT_TEMPLATES) {
      expect(MIGRATION).toContain(`'${template.name}'`);

      const seedRow = MIGRATION.slice(MIGRATION.indexOf(`'${template.name}'`));
      const upToNextRow = seedRow.slice(0, seedRow.indexOf("),"));
      expect(upToNextRow).toContain(String(template.required));
      expect(upToNextRow).toContain(`'${template.expected_from}'`);
    }
  });
});

// -----------------------------------------------------------------------------
describe("the migration's own guarantees", () => {
  // These assert the SQL, because the rules they describe are only true if the
  // database enforces them — a route handler is bypassable via PostgREST.

  it("creates the onboarding record from a trigger on applications", () => {
    expect(MIGRATION).toContain("create trigger trg_applications_create_onboarding");
    expect(MIGRATION).toContain("after insert or update of stage on public.applications");
  });

  it("makes one record per hire impossible to duplicate", () => {
    expect(MIGRATION).toContain("application_id uuid not null unique");
    expect(MIGRATION).toContain("on conflict (application_id) do nothing");
  });

  it("gives records no client INSERT policy", () => {
    // Creation is a consequence of a stage change, never an action. A client
    // that could insert one could manufacture a hire nobody hired.
    expect(MIGRATION).not.toContain("create policy onboarding_records_insert");
  });

  it("forbids a recruiter from producing a verified or rejected row", () => {
    const policy = MIGRATION.slice(
      MIGRATION.indexOf("create policy onboarding_documents_update_recruiter")
    );
    const body = policy.slice(0, policy.indexOf(";"));
    expect(body).toContain("status in ('pending', 'uploaded')");
    expect(body).toContain("verified_by is null");
  });

  it("requires a reason on every rejection in the database, not just the form", () => {
    expect(MIGRATION).toContain("onboarding_documents_rejected_has_reason");
  });

  it("keeps the documents bucket private", () => {
    // Identity documents. A public bucket would make every uploaded PAN card
    // readable by URL to anyone who guessed it.
    const bucket = MIGRATION.slice(MIGRATION.indexOf("insert into storage.buckets"));
    const values = bucket.slice(0, bucket.indexOf("on conflict")).replace(/\s+/g, " ");
    expect(values).toContain("'onboarding-documents', 'onboarding-documents', false,");
  });

  it("authorises storage on the organization folder, not on the caller's word", () => {
    const policy = MIGRATION.slice(
      MIGRATION.indexOf("create policy onboarding_docs_storage_select")
    );
    expect(policy.slice(0, policy.indexOf(";"))).toContain(
      "public.is_org_member(((storage.foldername(name))[1])::uuid)"
    );
  });

  it("snapshots the checklist instead of joining it", () => {
    // The spec's requirement that editing the checklist never disturbs a hire
    // already in progress is true only because name/required/expected_from are
    // COPIED onto the document row at generation time.
    const generation = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.create_onboarding_on_hire"));
    const body = generation.slice(0, generation.indexOf("$$;"));
    expect(body).toContain("t.name");
    expect(body).toContain("t.required");
    expect(body).toContain("t.expected_from");
    expect(body).toContain("and t.active");
  });
});
