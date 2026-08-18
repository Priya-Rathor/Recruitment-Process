// =============================================================================
// Module 19 — the onboarding checklist's pure logic.
//
// No database handle, no fetch, no React. Everything here is a function of its
// arguments, which is why the completion gate can be tested directly instead of
// through a route.
//
// THE COMPLETION GATE IS THE POINT OF THIS FILE.
//
// "Mark onboarding complete" is enabled only when every REQUIRED document is
// Verified. Getting that wrong in either direction is expensive: too strict and
// a hire is stuck behind an optional relieving letter they will never produce;
// too loose and someone is marked onboarded without a signed offer letter on
// file. So the rule is computed in one place, returns the reasons alongside the
// verdict, and the UI never re-derives it.
// =============================================================================

export const ONBOARDING_STATUSES = ["in_progress", "completed", "on_hold"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const DOCUMENT_STATUSES = ["pending", "uploaded", "verified", "rejected"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_OWNERS = ["candidate", "recruiter"] as const;
/** Who is EXPECTED to provide a document — not who uploaded it. */
export type DocumentOwner = (typeof DOCUMENT_OWNERS)[number];

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
};

/**
 * Amber for in-progress, per the spec.
 *
 * Note this is NOT "in progress is a problem" — it is the state that wants
 * attention, and the list exists to surface those. Completed is green, on hold
 * is neutral because somebody chose it.
 */
export const ONBOARDING_STATUS_TONE: Record<OnboardingStatus, "warning" | "success" | "neutral"> = {
  in_progress: "warning",
  completed: "success",
  on_hold: "neutral",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: "Pending",
  uploaded: "Uploaded",
  verified: "Verified",
  rejected: "Rejected",
};

export const DOCUMENT_STATUS_TONE: Record<
  DocumentStatus,
  "neutral" | "info" | "success" | "error"
> = {
  pending: "neutral",
  uploaded: "info",
  verified: "success",
  rejected: "error",
};

export const DOCUMENT_OWNER_LABELS: Record<DocumentOwner, string> = {
  candidate: "Candidate",
  recruiter: "Recruiter",
};

export function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return typeof value === "string" && (ONBOARDING_STATUSES as readonly string[]).includes(value);
}

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === "string" && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

export function isDocumentOwner(value: unknown): value is DocumentOwner {
  return typeof value === "string" && (DOCUMENT_OWNERS as readonly string[]).includes(value);
}

/** The subset of a document row this logic needs. */
export type ChecklistDocument = {
  id: string;
  name: string;
  required: boolean;
  status: DocumentStatus;
};

export type ChecklistProgress = {
  /** Required documents only — the ones that gate completion. */
  requiredTotal: number;
  requiredVerified: number;
  /** Every document, required or not. The fraction shown on the list page. */
  total: number;
  verified: number;
  /** 0-100, of REQUIRED documents. 100 when there are none to collect. */
  percent: number;
};

/**
 * Progress, counting required and total separately.
 *
 * The percentage tracks REQUIRED documents because that is what completion
 * depends on — a bar that crept forward on optional paperwork would suggest a
 * hire was nearly done when the offer letter was still missing.
 *
 * An empty checklist is 100%, not 0%. There is nothing outstanding, and showing
 * 0% for "nothing to collect" reads as "nothing done".
 */
export function checklistProgress(documents: ChecklistDocument[]): ChecklistProgress {
  const required = documents.filter((document) => document.required);
  const requiredVerified = required.filter((document) => document.status === "verified").length;
  const verified = documents.filter((document) => document.status === "verified").length;

  return {
    requiredTotal: required.length,
    requiredVerified,
    total: documents.length,
    verified,
    percent:
      required.length === 0
        ? 100
        : Math.round((requiredVerified / required.length) * 100),
  };
}

export type CompletionCheck = {
  canComplete: boolean;
  /**
   * The required documents standing in the way, by name and current status.
   *
   * Returned rather than a bare boolean so the disabled button can say WHAT is
   * missing. "Not yet" with no explanation is the thing that makes a user click
   * repeatedly and then file a bug.
   */
  blockers: { id: string; name: string; status: DocumentStatus }[];
};

/**
 * Whether this hire's onboarding may be marked complete.
 *
 * Optional documents never block — a first-time employee has no relieving
 * letter, and holding their onboarding open forever over a document that does
 * not exist is not a policy anyone chose.
 */
export function completionCheck(documents: ChecklistDocument[]): CompletionCheck {
  const blockers = documents
    .filter((document) => document.required && document.status !== "verified")
    .map((document) => ({ id: document.id, name: document.name, status: document.status }));

  return { canComplete: blockers.length === 0, blockers };
}

/**
 * One sentence naming what is still outstanding, for the disabled button's
 * tooltip. Null when nothing is.
 *
 * Truncated at three names: a checklist of fifteen would otherwise produce a
 * tooltip nobody reads to the end of.
 */
export function blockerSummary(blockers: CompletionCheck["blockers"]): string | null {
  if (blockers.length === 0) return null;

  const names = blockers.slice(0, 3).map((blocker) => blocker.name);
  const rest = blockers.length - names.length;
  const list = rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");

  return blockers.length === 1
    ? `${list} is not verified yet.`
    : `${list} are not verified yet.`;
}

/**
 * Required documents first, then optional, each group in its configured order.
 *
 * A stable sort on a copy — mutating the caller's array would reorder the rows
 * a server component already handed to two different children.
 */
export function groupedForDisplay<T extends { required: boolean; display_order: number; name: string }>(
  documents: T[]
): { required: T[]; optional: T[] } {
  const byOrder = (a: T, b: T) =>
    a.display_order - b.display_order || a.name.localeCompare(b.name);

  return {
    required: documents.filter((document) => document.required).sort(byOrder),
    optional: documents.filter((document) => !document.required).sort(byOrder),
  };
}

/**
 * Which actions a viewer may take on one document.
 *
 * Derived from role and status together, in one place, so the buttons rendered
 * and the transitions the API accepts cannot disagree. VERIFICATION IS
 * OWNER/ADMIN ONLY — the default the spec asked for. A recruiter uploading and
 * then verifying their own upload is not a review.
 */
export function documentActions({
  status,
  canManage,
  canVerify,
}: {
  status: DocumentStatus;
  /** Owner/Admin, or the Recruiter this record is assigned to. */
  canManage: boolean;
  /** Owner/Admin only. */
  canVerify: boolean;
}): {
  canUpload: boolean;
  canVerify: boolean;
  canReject: boolean;
  canView: boolean;
} {
  return {
    // A verified document is not replaced in place. Un-verifying it first is an
    // Owner/Admin decision, and it should be visible that it happened.
    canUpload: canManage && status !== "verified",
    canVerify: canVerify && (status === "uploaded" || status === "rejected"),
    canReject: canVerify && status === "uploaded",
    canView: status !== "pending",
  };
}

/**
 * How long a document has been waiting, in whole days.
 *
 * Used by the reminder sweep. Takes `now` as an argument rather than reading the
 * clock, so the test does not have to freeze time.
 */
export function daysWaiting(createdAt: string, now: Date): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.floor((now.getTime() - created) / 86_400_000);
}

/**
 * Required documents still Pending for longer than the configured window.
 *
 * Pending only — an uploaded document is somebody else's turn, and reminding the
 * assignee about a document sitting in their own review queue is what
 * `onboarding_document_uploaded` already did when it arrived.
 *
 * A window of 0 disables the sweep entirely rather than reminding about
 * everything, which is how a reminder system gets muted.
 */
export function overduePendingDocuments<
  T extends { id: string; name: string; required: boolean; status: DocumentStatus; created_at: string },
>({ documents, reminderDays, now }: { documents: T[]; reminderDays: number; now: Date }): T[] {
  if (reminderDays <= 0) return [];

  return documents.filter(
    (document) =>
      document.required &&
      document.status === "pending" &&
      daysWaiting(document.created_at, now) >= reminderDays
  );
}
