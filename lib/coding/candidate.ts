// =============================================================================
// The CANDIDATE side of live coding.
//
// WHY THIS FILE USES THE SERVICE-ROLE CLIENT.
//
// The candidate has no session. Every RLS policy in this product answers
// "is the caller a member of this organization?", and the honest answer here is
// no — they are the subject of the hiring process, not a participant in the
// workspace. A session-bound client would have every one of these queries
// denied, and inventing a membership for them would be far worse than the
// narrow, explicit scoping below.
//
// So this is the same shape as the Bolna webhook: no session exists, the
// service-role client is used, and EVERY query is scoped by an id that came out
// of a verified signature — never out of the request body.
//
// THE THREE RULES THIS FILE KEEPS, in the order it applies them:
//
//   1. The session id comes from verifyAccessToken(), never from the caller.
//      A forged id in a body is ignored because no body supplies one.
//   2. organization_id is read from OUR row and used to scope everything after
//      it. The candidate never states which tenant they belong to.
//   3. Access is re-checked on EVERY call, not just on page load. A round
//      cancelled while the candidate is typing stops accepting saves on their
//      next keystroke, which is the only behaviour an interviewer who just hit
//      Cancel would consider correct.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAccessToken } from "@/lib/coding/token";
import {
  checkSessionAccess,
  MAX_CODE_LENGTH,
  type AccessRefusal,
  type CodingSessionStatus,
} from "@/lib/coding/session";
import {
  defaultLanguage,
  isCodingLanguage,
  LANGUAGE_STARTERS,
  normalizeLanguages,
  type CodingLanguage,
} from "@/lib/coding/languages";
import { formatDbError } from "@/lib/supabase/errors";

/** What the candidate's page and its API routes are allowed to know. */
export type CandidateSessionView = {
  sessionId: string;
  status: CodingSessionStatus;
  questionTitle: string;
  questionDescription: string;
  instructions: string | null;
  languages: CodingLanguage[];
  timeLimitMinutes: number | null;
  expiresAt: string;
  submittedAt: string | null;
  /** First name only — see resolveCandidateGreeting() for why. */
  candidateName: string | null;
  jobTitle: string | null;
  organizationName: string | null;
  language: CodingLanguage;
  code: string;
  lastSavedAt: string | null;
};

export type CandidateSessionResult =
  | { ok: true; view: CandidateSessionView }
  /**
   * `invalid` is deliberately indistinguishable from "no such session".
   * Separating them would let somebody probe which session ids exist.
   */
  | { ok: false; code: AccessRefusal | "invalid" | "unavailable"; message: string };

const INVALID_MESSAGE =
  "This coding link isn't valid. Check you opened the most recent link your interviewer shared, or ask them for a new one.";

const UNAVAILABLE_MESSAGE =
  "This coding round can't be opened right now. Please tell your interviewer — they can start a new one.";

/**
 * Resolves a token to everything the candidate page renders.
 *
 * `touch` records the first open and moves the session to `in_progress`. It is
 * off by default so the API routes — which call this on every autosave — do not
 * rewrite the row on every keystroke.
 */
export async function loadCandidateSession(
  token: string,
  { touch = false }: { touch?: boolean } = {}
): Promise<CandidateSessionResult> {
  const sessionId = await verifyAccessToken(token);
  if (!sessionId) return { ok: false, code: "invalid", message: INVALID_MESSAGE };

  const admin = createAdminClient();
  if (!admin) {
    // No service-role key configured. Reported as unavailable rather than as an
    // invalid link: the candidate has done nothing wrong and telling them their
    // link is broken would send them chasing the wrong thing.
    console.error("[coding] service-role client unavailable; candidate access cannot work.");
    return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  const { data, error } = await admin
    .from("coding_sessions")
    .select(
      "id, organization_id, status, question_title, question_description, instructions, " +
        "languages, time_limit_minutes, expires_at, submitted_at, opened_at, " +
        "submission:coding_submissions(programming_language, code, last_saved_at), " +
        "organization:organizations(name), " +
        "application:applications(candidate:candidates(name), job:jobs(title))"
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    console.error(`[coding] candidate session load failed: ${formatDbError(error)}`);
    return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  }
  // A signature that verifies against a row that no longer exists reads exactly
  // like a forged one, on purpose.
  if (!data) return { ok: false, code: "invalid", message: INVALID_MESSAGE };

  const row = data as unknown as {
    id: string;
    organization_id: string;
    status: CodingSessionStatus;
    question_title: string;
    question_description: string;
    instructions: string | null;
    languages: string[] | null;
    time_limit_minutes: number | null;
    expires_at: string;
    submitted_at: string | null;
    opened_at: string | null;
    submission:
      | { programming_language: string; code: string; last_saved_at: string }[]
      | { programming_language: string; code: string; last_saved_at: string }
      | null;
    organization: { name: string } | null;
    application: { candidate: { name: string } | null; job: { title: string } | null } | null;
  };

  const access = checkSessionAccess({ status: row.status, expiresAt: row.expires_at });

  const submission = Array.isArray(row.submission) ? row.submission[0] ?? null : row.submission;
  const languages = normalizeLanguages(row.languages);

  // A refused session still returns its question and, when it was submitted,
  // the code — so the candidate can see what they sent rather than a bare
  // "already submitted" with no evidence of their own work.
  if (!access.open) {
    if (access.code === "submitted") {
      return {
        ok: true,
        view: buildView({ row, submission, languages, status: access.status }),
      };
    }
    return { ok: false, code: access.code, message: access.message };
  }

  if (touch && !row.opened_at) {
    // Best effort. A candidate must never be blocked from starting because a
    // bookkeeping column would not write.
    const { error: touchError } = await admin
      .from("coding_sessions")
      .update({ opened_at: new Date().toISOString(), status: "in_progress" })
      .eq("id", row.id)
      .eq("organization_id", row.organization_id);

    if (touchError) {
      console.error(`[coding] could not mark session opened: ${formatDbError(touchError)}`);
    }
  }

  return { ok: true, view: buildView({ row, submission, languages, status: row.status }) };
}

function buildView({
  row,
  submission,
  languages,
  status,
}: {
  row: {
    id: string;
    question_title: string;
    question_description: string;
    instructions: string | null;
    time_limit_minutes: number | null;
    expires_at: string;
    submitted_at: string | null;
    organization: { name: string } | null;
    application: { candidate: { name: string } | null; job: { title: string } | null } | null;
  };
  submission: { programming_language: string; code: string; last_saved_at: string } | null;
  languages: CodingLanguage[];
  status: CodingSessionStatus;
}): CandidateSessionView {
  const language =
    submission && isCodingLanguage(submission.programming_language)
      ? submission.programming_language
      : defaultLanguage(languages);

  return {
    sessionId: row.id,
    status,
    questionTitle: row.question_title,
    questionDescription: row.question_description,
    instructions: row.instructions,
    languages,
    timeLimitMinutes: row.time_limit_minutes,
    expiresAt: row.expires_at,
    submittedAt: row.submitted_at,
    candidateName: firstNameOf(row.application?.candidate?.name ?? null),
    jobTitle: row.application?.job?.title ?? null,
    organizationName: row.organization?.name ?? null,
    language,
    // An empty buffer is replaced by the language's stub only when nothing has
    // ever been saved. Once the candidate has saved, even an empty string is
    // THEIR empty string and must not be quietly repopulated.
    code: submission ? submission.code : LANGUAGE_STARTERS[language],
    lastSavedAt: submission?.last_saved_at ?? null,
  };
}

/**
 * First name only.
 *
 * The page greets the candidate so they can be sure the link is theirs and not
 * a colleague's. A full name adds nothing to that check and puts more personal
 * data on an unauthenticated page than the check requires.
 */
function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

export type SaveResult =
  | { ok: true; lastSavedAt: string; saveCount: number }
  | { ok: false; code: AccessRefusal | "invalid" | "unavailable" | "rejected"; message: string };

/**
 * Saves a draft. Used by BOTH autosave and the manual button.
 *
 * One path deliberately: two save routes would eventually disagree about
 * validation, and the one that got it wrong would be the automatic one nobody
 * watches.
 */
export async function saveDraft({
  token,
  code,
  language,
}: {
  token: string;
  code: string;
  language: string;
}): Promise<SaveResult> {
  const resolved = await resolveWritableSession(token);
  if (!resolved.ok) return resolved;

  const { admin, sessionId, organizationId, languages } = resolved;

  if (typeof code !== "string") {
    return { ok: false, code: "rejected", message: "Nothing to save." };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return {
      ok: false,
      code: "rejected",
      message: "That's longer than this editor can save. Trim it down and try again.",
    };
  }
  if (!isCodingLanguage(language) || !languages.includes(language)) {
    return { ok: false, code: "rejected", message: "That language isn't available for this round." };
  }

  const now = new Date().toISOString();

  // Read-then-write rather than a bare upsert, because save_count is a counter
  // and an upsert would reset it to 1 on every autosave.
  const { data: existing } = await admin
    .from("coding_submissions")
    .select("id, save_count")
    .eq("coding_session_id", sessionId)
    .maybeSingle();

  if (!existing) {
    const { data, error } = await admin
      .from("coding_submissions")
      .insert({
        organization_id: organizationId,
        coding_session_id: sessionId,
        programming_language: language,
        code,
        last_saved_at: now,
        save_count: 1,
      })
      .select("last_saved_at, save_count")
      .single();

    if (error) {
      console.error(`[coding] draft insert failed: ${formatDbError(error)}`);
      return { ok: false, code: "unavailable", message: SAVE_FAILED_MESSAGE };
    }

    const inserted = data as unknown as { last_saved_at: string; save_count: number };
    return { ok: true, lastSavedAt: inserted.last_saved_at, saveCount: inserted.save_count };
  }

  const current = existing as unknown as { id: string; save_count: number };

  const { data, error } = await admin
    .from("coding_submissions")
    .update({
      programming_language: language,
      code,
      last_saved_at: now,
      save_count: current.save_count + 1,
    })
    .eq("id", current.id)
    .eq("organization_id", organizationId)
    .select("last_saved_at, save_count")
    .single();

  if (error) {
    console.error(`[coding] draft update failed: ${formatDbError(error)}`);
    return { ok: false, code: "unavailable", message: SAVE_FAILED_MESSAGE };
  }

  const updated = data as unknown as { last_saved_at: string; save_count: number };
  return { ok: true, lastSavedAt: updated.last_saved_at, saveCount: updated.save_count };
}

const SAVE_FAILED_MESSAGE =
  "Unable to save. Your code is still here — check your connection and try again.";

export type SubmitResult =
  | { ok: true; submittedAt: string; applicationId: string; organizationId: string; sessionId: string }
  | { ok: false; code: AccessRefusal | "invalid" | "unavailable" | "rejected"; message: string };

/**
 * The final submission.
 *
 * Saves the latest code FIRST and only then flips the status, so a failure
 * between the two leaves a saved draft rather than a session marked submitted
 * with nothing in it. The reverse order would lose the candidate's work at the
 * exact moment it mattered most.
 */
export async function submitCode({
  token,
  code,
  language,
}: {
  token: string;
  code: string;
  language: string;
}): Promise<SubmitResult> {
  const saved = await saveDraft({ token, code, language });
  if (!saved.ok) return saved;

  const resolved = await resolveWritableSession(token);
  if (!resolved.ok) return resolved;

  const { admin, sessionId, organizationId, applicationId } = resolved;
  const now = new Date().toISOString();

  const { error: submissionError } = await admin
    .from("coding_submissions")
    .update({ submitted_at: now })
    .eq("coding_session_id", sessionId)
    .eq("organization_id", organizationId);

  if (submissionError) {
    console.error(`[coding] submit stamp failed: ${formatDbError(submissionError)}`);
    return { ok: false, code: "unavailable", message: SUBMIT_FAILED_MESSAGE };
  }

  const { error: sessionError } = await admin
    .from("coding_sessions")
    .update({ status: "submitted", submitted_at: now })
    .eq("id", sessionId)
    .eq("organization_id", organizationId);

  if (sessionError) {
    console.error(`[coding] submit status failed: ${formatDbError(sessionError)}`);
    return { ok: false, code: "unavailable", message: SUBMIT_FAILED_MESSAGE };
  }

  return { ok: true, submittedAt: now, applicationId, organizationId, sessionId };
}

const SUBMIT_FAILED_MESSAGE =
  "Your code is saved, but we couldn't complete the submission. Try Submit again, and tell your interviewer if it keeps failing.";

// -----------------------------------------------------------------------------
// Shared resolution
// -----------------------------------------------------------------------------

type WritableSession = {
  ok: true;
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  sessionId: string;
  organizationId: string;
  applicationId: string;
  languages: CodingLanguage[];
};

/**
 * Verifies the token and re-checks access, for a call that intends to WRITE.
 *
 * Called on every save, not cached. That is the point: a session cancelled or
 * expired since the page loaded must stop accepting code immediately, and the
 * only way to know is to ask.
 */
async function resolveWritableSession(
  token: string
): Promise<WritableSession | { ok: false; code: AccessRefusal | "invalid" | "unavailable"; message: string }> {
  const sessionId = await verifyAccessToken(token);
  if (!sessionId) return { ok: false, code: "invalid", message: INVALID_MESSAGE };

  const admin = createAdminClient();
  if (!admin) {
    console.error("[coding] service-role client unavailable; candidate writes cannot work.");
    return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  const { data, error } = await admin
    .from("coding_sessions")
    .select("id, organization_id, application_id, status, expires_at, languages")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    console.error(`[coding] writable session load failed: ${formatDbError(error)}`);
    return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  }
  if (!data) return { ok: false, code: "invalid", message: INVALID_MESSAGE };

  const row = data as unknown as {
    id: string;
    organization_id: string;
    application_id: string;
    status: CodingSessionStatus;
    expires_at: string;
    languages: string[] | null;
  };

  const access = checkSessionAccess({ status: row.status, expiresAt: row.expires_at });
  if (!access.open) return { ok: false, code: access.code, message: access.message };

  return {
    ok: true,
    admin,
    sessionId: row.id,
    organizationId: row.organization_id,
    applicationId: row.application_id,
    languages: normalizeLanguages(row.languages),
  };
}
