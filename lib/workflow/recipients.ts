// =============================================================================
// Who a workflow message goes to.
//
// PURE. No database, no `next/headers`, no Supabase import — this file is
// imported by the builder UI (a "use client" component) and by the engine
// (server), and AGENTS.md is unambiguous about what happens when a client
// component can reach a server-side module. Resolution against real rows lives
// in lib/workflow/resolveRecipients.ts, which is server-only. See
// lib/voice/costModel.ts vs lib/voice/cost.ts for the same split.
//
// -----------------------------------------------------------------------------
// WHY "NOTIFY INTERNAL TEAM" IS NOT AN ACTION TYPE.
//
// The brief asks for it as a feature and then answers its own design question:
// "build it as a recipient option on the existing actions, not a fully separate
// action type, to avoid duplicating the templating system."
//
// That is the whole reason this file exists. An internal notification needs
// exactly what a candidate message needs — a template, the placeholder picker,
// channel selection, rendering, a send log — and the only thing that differs is
// the address it resolves to. A separate action type would have meant a second
// template picker, a second renderer and a second log, and the day somebody
// added a placeholder to one of them the other would silently not have it.
//
// So: one action (`send_templated_message`), one templating system, and a
// recipient list. "Notify the assigned recruiter that Rahul passed" is the same
// machinery as "tell Rahul he passed", pointed at a different mailbox.
//
// -----------------------------------------------------------------------------
// THE PLACEHOLDER SUBTLETY THAT MAKES THIS WORTH DOING CAREFULLY.
//
// A message to an internal person still renders CANDIDATE placeholders — that is
// the point of it: "{{candidate.name}} just passed the technical assessment with
// {{application.match_score}} for {{job.title}}" is addressed to a recruiter and
// is entirely about a candidate. So the render context does NOT change with the
// recipient. Only the address does.
//
// One thing does change, and it is the reason `isInternal` exists rather than
// being derived at the call site: the candidate opt-out and the unsubscribe
// footer are candidate-consent machinery. Applying them to a colleague would let
// a candidate's unsubscribe silence a recruiter's own notifications, and would
// staple "reply STOP to unsubscribe" to internal mail. Marketing-consent rules
// do not govern a message between two employees about their work.
// =============================================================================

export const RECIPIENT_KINDS = [
  "candidate",
  "assigned_recruiter",
  "job_owner",
  "organization_member",
] as const;

export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

export function isRecipientKind(value: unknown): value is RecipientKind {
  return typeof value === "string" && (RECIPIENT_KINDS as readonly string[]).includes(value);
}

/**
 * One entry in an action's recipient list.
 *
 * `userId` is set only for `organization_member`. The other three are resolved
 * from the application at send time rather than frozen here, because the person
 * who owns a job in March is not always the person who owns it in September, and
 * a stored id would keep mailing whoever it was when the rule was written.
 */
export type Recipient = {
  kind: RecipientKind;
  /** Only for `organization_member`. Ignored, and stripped, for every other kind. */
  userId?: string | null;
};

export const RECIPIENT_LABELS: Record<RecipientKind, string> = {
  candidate: "Candidate",
  assigned_recruiter: "Assigned recruiter",
  job_owner: "Job owner",
  organization_member: "A specific team member",
};

/**
 * The one-line explanation each option shows in the picker.
 *
 * Written out because "Job owner" and "Assigned recruiter" are the same person
 * on most applications and different on exactly the ones where it matters, and a
 * picker that does not say so gets chosen by coin flip.
 */
export const RECIPIENT_HINTS: Record<RecipientKind, string> = {
  candidate: "The person who applied.",
  assigned_recruiter: "Whoever is working this application right now.",
  job_owner: "The recruiter who owns the job, whether or not they were assigned.",
  organization_member: "A named colleague, whatever their involvement.",
};

/** True for everyone who is not the candidate. Drives opt-out and footer rules. */
export function isInternal(kind: RecipientKind): boolean {
  return kind !== "candidate";
}

/**
 * What an action defaults to when it is first added.
 *
 * Candidate for anything that reaches out, because that is what a hiring
 * pipeline mostly does and a wrong default that emails a colleague is more
 * surprising than a wrong default that emails an applicant.
 */
export const DEFAULT_RECIPIENTS: Recipient[] = [{ kind: "candidate" }];

/** Ceiling on one action's recipient list. Beyond this it is a mailing list. */
export const MAX_RECIPIENTS = 6;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecipientValidation =
  | { ok: true; recipients: Recipient[] }
  | { ok: false; error: string };

/**
 * Validates and normalises a stored or submitted recipient list.
 *
 * DEDUPLICATES. The same colleague reachable as both "Job owner" and "A specific
 * team member" is two entries here and one person in real life; sending twice
 * would look like a bug in the product rather than a duplicated configuration.
 * Kind-level duplicates are collapsed the same way. Address-level duplicates —
 * two different kinds resolving to one mailbox — are caught later, in
 * resolveRecipients(), because only a database read can see that.
 *
 * AN EMPTY LIST IS AN ERROR, NOT A DEFAULT. Falling back to the candidate would
 * mean a misconfigured internal notification silently mails the applicant
 * instead, which is the single worst outcome available in this file.
 */
export function validateRecipients(value: unknown): RecipientValidation {
  if (value === undefined || value === null) {
    return { ok: true, recipients: [...DEFAULT_RECIPIENTS] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: "Recipients must be a list." };
  }

  const recipients: Recipient[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;

    if (!isRecipientKind(raw.kind)) {
      return { ok: false, error: `Unknown recipient: ${String(raw.kind)}` };
    }

    if (raw.kind === "organization_member") {
      const userId = raw.userId ?? raw.user_id;
      if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
        return { ok: false, error: "Choose which team member to notify." };
      }
      const key = `member:${userId.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({ kind: "organization_member", userId });
      continue;
    }

    if (seen.has(raw.kind)) continue;
    seen.add(raw.kind);
    // userId is dropped rather than carried: a stored id on a `job_owner` entry
    // would be read by nobody and would look, to the next person, like the
    // resolution had been pinned.
    recipients.push({ kind: raw.kind });
  }

  if (recipients.length === 0) {
    return { ok: false, error: "Choose at least one recipient for this action." };
  }

  if (recipients.length > MAX_RECIPIENTS) {
    return {
      ok: false,
      error: `An action can have at most ${MAX_RECIPIENTS} recipients.`,
    };
  }

  return { ok: true, recipients };
}

/** Reads a stored action config's recipients, tolerating rows written before this existed. */
export function recipientsFrom(config: Record<string, unknown> | undefined): Recipient[] {
  const validated = validateRecipients(config?.recipients);
  // A stored list that no longer validates falls back to the candidate — the
  // pre-Module-25 behaviour, which is what every such row was written to mean.
  return validated.ok ? validated.recipients : [...DEFAULT_RECIPIENTS];
}

/** "Candidate and assigned recruiter" — for the action card's summary line. */
export function describeRecipients(recipients: Recipient[], memberNames?: Map<string, string>): string {
  if (recipients.length === 0) return "Nobody";

  const parts = recipients.map((recipient) => {
    if (recipient.kind === "organization_member") {
      const name = recipient.userId ? memberNames?.get(recipient.userId) : null;
      return name ?? "A team member";
    }
    return RECIPIENT_LABELS[recipient.kind];
  });

  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
