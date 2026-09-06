// =============================================================================
// One public submission, end to end.
//
//   validate -> STORE THE ANSWERS -> park the file -> extract -> AI parse
//            -> match (deterministic) -> candidate -> resume -> application
//            -> link the response back
//
// NOTHING HERE IS NEW LOGIC. Every decision that matters was already made and
// tested for the bulk resume intake path, and this file calls it:
//
//   normalizeEmail / normalizePhone   lib/candidates/dedupe.ts
//   resolveCandidateMatch             lib/intake/match.ts
//   extractResumeText                 lib/resumes/extract.ts
//   parseResume                       lib/ai/parseResume.ts
//   buildFieldComparisons             lib/resumes/review.ts
//   ensureApplicationForCandidate     lib/intake/process.ts
//
// A second matcher or a second parser for this entry point would mean the same
// person applying twice — once by public link, once by a recruiter uploading
// their CV — could be deduplicated one way and not the other.
//
// THE ORDER IS THE DESIGN, and there are three rules in it.
//
// 1. THE ANSWERS ARE SAVED FIRST. The applicant has typed for five minutes on a
//    phone. Their answers are written to form_responses before anything that
//    can fail — storage, an AI provider, a candidate insert — so a downstream
//    failure loses a link, never a submission. Everything after that step is
//    recorded on the row as `needs_attention` rather than thrown away.
//
// 2. AI FAILURE IS NOT SUBMISSION FAILURE. A scanned PDF with no text layer, a
//    provider outage, a rate limit: all normal. The applicant typed their
//    details in themselves, so the candidate and the application are created
//    from the typed answers and the resume is filed unparsed. Telling somebody
//    their application failed because our model was busy would be absurd.
//
// 3. AN EXISTING CANDIDATE IS NEVER OVERWRITTEN. Not by the parsed resume (that
//    proposal is queued in resume_parse_results with reviewed_at null, exactly
//    as intake does) and not by the typed answers either — a public form is an
//    unauthenticated claim about a record a human established. Disagreements
//    are reported on the response row for a recruiter to act on.
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDbError } from "@/lib/supabase/errors";
import { splitAnswers } from "@/lib/customFields/publicForm";
import { savePublicCustomAnswers } from "@/lib/customFields/publicFormQueries";
import { extractResumeText } from "@/lib/resumes/extract";
import { parseResume, type ParsedResume } from "@/lib/ai/parseResume";
import { buildFieldComparisons } from "@/lib/resumes/review";
import { RESUME_BUCKET } from "@/lib/resumes/queries";
import { isAllowedResumeUpload, RESUME_UPLOAD_REJECTION } from "@/lib/resumes/uploadPolicy";
import { normalizeEmail, normalizePhone } from "@/lib/candidates/dedupe";
import { resolveCandidateMatch } from "@/lib/intake/match";
import { ensureApplicationForCandidate } from "@/lib/intake/process";
import { logActivity, logAiCall } from "@/lib/activity/log";
import {
  candidateFieldsFromAnswers,
  mergeWithParsedResume,
  typedProfileConflicts,
  type TypedCandidateFields,
} from "@/lib/forms/candidateFields";
import { RESUME_FIELD_KEY } from "@/lib/forms/fields";
import { validateAnswers, type AnswerErrors } from "@/lib/forms/validation";
import { loadPublicForm, type PublicField } from "@/lib/forms/public";
import {
  checkSubmissionRate,
  clientAddressFrom,
  hashAddress,
  pruneSubmissionAttempts,
} from "@/lib/forms/rateLimit";
import type { AnswerValue, FormResponseStatus } from "@/lib/forms/types";
import type { Candidate } from "@/lib/types";

/** Mirrors the resumes bucket's file_size_limit, like the intake route's cap. */
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export type SubmitInput = {
  token: string;
  /** field_key -> raw value, as parsed from the multipart body. */
  answers: Record<string, unknown>;
  file: { name: string; type: string | null; buffer: ArrayBuffer } | null;
  /** Request headers, for the rate-limit source. Never stored raw. */
  headers: Headers;
  /** Origin of the request, so the acknowledgement's links are absolute. */
  origin: string;
};

export type SubmitResult =
  | { ok: true; message: string }
  | {
      ok: false;
      /**
       * `closed` / `invalid` / `unavailable` mirror loadPublicForm.
       * `invalid_input` carries per-field errors the page shows inline.
       * `rate_limited` is a refusal the applicant can understand.
       */
      code: "closed" | "invalid" | "unavailable" | "invalid_input" | "rate_limited";
      message: string;
      fieldErrors?: AnswerErrors;
    };

const THANK_YOU =
  "Thank you! Your application has been submitted successfully. " +
  "If your experience matches what the team is looking for, someone will be in touch.";

/**
 * Handles one submission.
 *
 * Never throws for an expected failure — a closed form, a corrupt PDF, an AI
 * outage and a rate limit are all normal events, and each is returned as a
 * result the route turns into a response the applicant can act on.
 */
export async function submitApplication(input: SubmitInput): Promise<SubmitResult> {
  // --- 1. The form, re-checked ----------------------------------------------
  //
  // Re-loaded rather than trusted from the page render: a recruiter may have
  // disabled the form, archived the job or regenerated the link while this
  // person was typing.
  const form = await loadPublicForm(input.token);
  if (!form.ok) return { ok: false, code: form.code, message: form.message };

  const admin = createAdminClient();
  if (!admin) {
    console.error("[forms] service-role client unavailable; submission cannot be stored.");
    return {
      ok: false,
      code: "unavailable",
      message: "Applications can't be submitted right now. Please try again shortly.",
    };
  }

  const { formId, organizationId, view } = form;

  // --- 2. Rate limit, BEFORE any file or AI work ----------------------------
  const ipHash = await hashAddress(clientAddressFrom(input.headers));
  const rate = await checkSubmissionRate({ admin, formId, ipHash });
  if (!rate.allowed) {
    return { ok: false, code: "rate_limited", message: rate.message };
  }

  // --- 3. The file, BEFORE parsing ------------------------------------------
  //
  // Type and size are checked here so an anonymous caller cannot reach the
  // extraction and AI pipeline with a 10 MB junk file. Same policy module the
  // recruiter-side upload uses, so the two ends cannot disagree about what a
  // resume is.
  const resumeField = view.fields.find((field) => field.fieldType === "file_upload");

  if (input.file) {
    if (!isAllowedResumeUpload(input.file.name, input.file.type)) {
      return {
        ok: false,
        code: "invalid_input",
        message: RESUME_UPLOAD_REJECTION,
        fieldErrors: { [resumeField?.fieldKey ?? RESUME_FIELD_KEY]: RESUME_UPLOAD_REJECTION },
      };
    }
    if (input.file.buffer.byteLength > MAX_RESUME_BYTES) {
      const message = "That file is larger than 10 MB. Please attach a smaller file.";
      return {
        ok: false,
        code: "invalid_input",
        message,
        fieldErrors: { [resumeField?.fieldKey ?? RESUME_FIELD_KEY]: message },
      };
    }
    if (input.file.buffer.byteLength === 0) {
      const message = "That file appears to be empty. Please attach your resume again.";
      return {
        ok: false,
        code: "invalid_input",
        message,
        fieldErrors: { [resumeField?.fieldKey ?? RESUME_FIELD_KEY]: message },
      };
    }
  }

  // --- 4. Every field, re-validated server-side -----------------------------
  //
  // The page validates as they type; that is a courtesy anybody can skip with
  // curl. THIS is the check that counts, and it runs against the field
  // definitions read from the database — never against anything the request
  // said about them.
  const validated = validateAnswers({
    fields: toValidatorFields(view.fields),
    raw: input.answers,
    uploadedFileKeys: input.file && resumeField ? [resumeField.fieldKey] : [],
  });

  if (!validated.ok) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Some answers need fixing before this can be submitted.",
      fieldErrors: validated.errors,
    };
  }

  const answers = validated.answers;
  if (input.file && resumeField) {
    // The file itself is not in raw_answers — only its name, so a recruiter
    // reading the response can see what was attached. Keyed on the form's OWN
    // file field rather than a constant: a form with no file field must not
    // grow a phantom "resume" answer because somebody posted a file to it.
    answers[resumeField.fieldKey] = input.file.name.slice(-200);
  }

  // --- 5. STORE THE ANSWERS. Everything after this point is recoverable. ----
  const { data: responseRow, error: responseError } = await admin
    .from("form_responses")
    .insert({
      organization_id: organizationId,
      form_id: formId,
      raw_answers: answers,
      status: "received",
      submitter_ip_hash: ipHash,
    })
    .select("id")
    .single();

  if (responseError || !responseRow) {
    console.error(`[forms] storing the response failed: ${formatDbError(responseError)}`);
    return {
      ok: false,
      code: "unavailable",
      message:
        "We couldn't save your application. Nothing was submitted — please try again in a moment.",
    };
  }

  const responseId = (responseRow as { id: string }).id;

  // Opportunistic housekeeping, best effort, never blocking.
  await pruneSubmissionAttempts({ admin, formId });

  /*
    A STANDALONE FORM STOPS HERE, and that is the whole difference between the
    two purposes. A pre-interview questionnaire has no job to apply to and must
    not create a candidate — it is somebody who already exists answering
    questions. Its answers are stored, and the recruiter reads them.
  */
  if (!view.job) {
    await markResponse({ admin, responseId, organizationId, status: "linked" });
    return { ok: true, message: THANK_YOU };
  }

  // --- 6. Resolve the person, and the application ---------------------------
  const outcome = await resolveCandidateAndApplication({
    admin,
    organizationId,
    formId,
    answers,
    file: input.file,
    origin: input.origin,
  });

  await markResponse({
    admin,
    responseId,
    organizationId,
    status: outcome.status,
    candidateId: outcome.candidateId,
    applicationId: outcome.applicationId,
    resumeId: outcome.resumeId,
    error: outcome.error,
  });

  /*
    MODULE 27 — the job's custom questions, filed against THIS application.

    Runs only once there is an application to attach them to: the definition
    belongs to the job, but the answer belongs to the applicant, and without an
    application id there is nothing to answer for. A submission that failed to
    produce an application still has its answers in raw_answers above.

    Not awaited for its result beyond a log. See savePublicCustomAnswers().
  */
  if (outcome.applicationId) {
    const { customAnswers } = splitAnswers(answers);
    if (Object.keys(customAnswers).length > 0) {
      await savePublicCustomAnswers({
        admin,
        organizationId,
        applicationId: outcome.applicationId,
        answers: customAnswers,
      });
    }
  }

  // THE APPLICANT IS TOLD IT WORKED EITHER WAY, and that is deliberate: their
  // answers are in the database and a recruiter can see the row. A failure to
  // create the candidate record is our problem to fix, not a reason to send
  // somebody away to re-type five minutes of work.
  return { ok: true, message: THANK_YOU };
}

function toValidatorFields(fields: PublicField[]) {
  return fields.map((field) => ({
    field_key: field.fieldKey,
    label: field.label,
    field_type: field.fieldType,
    options: field.options,
    required: field.required,
  }));
}

type ResolveOutcome = {
  status: FormResponseStatus;
  candidateId: string | null;
  applicationId: string | null;
  resumeId: string | null;
  error: string | null;
};

/**
 * Everything from "we have their answers" to "they are in the pipeline".
 *
 * Returns an outcome instead of throwing, so every failure lands on the response
 * row where a recruiter can see it.
 */
async function resolveCandidateAndApplication({
  admin,
  organizationId,
  formId,
  answers,
  file,
  origin,
}: {
  admin: SupabaseClient;
  organizationId: string;
  formId: string;
  answers: Record<string, AnswerValue>;
  file: { name: string; type: string | null; buffer: ArrayBuffer } | null;
  origin: string;
}): Promise<ResolveOutcome> {
  const failure = (error: string): ResolveOutcome => ({
    status: "needs_attention",
    candidateId: null,
    applicationId: null,
    resumeId: null,
    error,
  });

  // The job is read from OUR form row, never from the request.
  const { data: formRow, error: formError } = await admin
    .from("forms")
    .select("job_id, job:jobs(title)")
    .eq("id", formId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (formError || !formRow) {
    return failure("Could not read the job this form belongs to.");
  }

  const jobId = (formRow as { job_id: string | null }).job_id;
  if (!jobId) return failure("This form is no longer linked to a job.");

  const { data: orgRow } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  const organizationName = (orgRow as { name: string } | null)?.name ?? "the hiring team";

  const typed = candidateFieldsFromAnswers(answers);

  // Every candidate needs a name and a way to be reached — the database
  // enforces both (`name` non-blank, `candidates_contactable`). The form
  // requires email, so this only fires on a form somebody has since edited.
  if (!typed.name) return failure("The submission had no name to file it under.");
  if (!typed.email && !typed.phone) {
    return failure("The submission had no email address or phone number.");
  }

  // --- Resume: park the file, then extract and parse ------------------------
  let parked: string | null = null;
  let parsed: ParsedResume | null = null;
  let extractedCharacters = 0;
  let parseNote: string | null = null;

  if (file) {
    parked = await parkFile({ admin, organizationId, file });
    if (!parked) parseNote = "The resume could not be stored.";

    const extraction = await extractResumeText({
      buffer: file.buffer,
      fileName: file.name,
      mimeType: file.type,
    });

    if (!extraction.ok) {
      // Kept, not discarded: a resume that could not be read is still that
      // person's resume, and a recruiter can open it themselves.
      parseNote = extraction.message;
    } else {
      extractedCharacters = extraction.characters;
      const result = await parseResume(extraction.text);

      await logAiCall({
        organizationId,
        actorId: null,
        actorLabel: "Public application form",
        feature: "parseResume",
        entityType: "job",
        entityId: jobId,
        ok: result.ok,
        errorCode: result.ok ? null : result.code,
        useAdminClient: true,
      });

      if (result.ok) parsed = result.data;
      else parseNote = result.message;
    }
  }

  // --- Match: deterministic, and the same rule bulk intake uses -------------
  const emailKey = normalizeEmail(typed.email);
  const phoneKey = normalizePhone(typed.phone);

  const conditions: string[] = [];
  if (emailKey) conditions.push(`email_normalized.eq.${emailKey}`);
  if (phoneKey) conditions.push(`phone_normalized.eq.${phoneKey}`);

  const { data: existingRows, error: lookupError } = conditions.length
    ? await admin
        .from("candidates")
        .select("id, name, email_normalized, phone_normalized")
        .eq("organization_id", organizationId)
        .or(conditions.join(","))
        .limit(25)
    : { data: [], error: null };

  if (lookupError) {
    // Treating a failed lookup as "no match" would create a duplicate person.
    console.error(`[forms] duplicate lookup failed: ${formatDbError(lookupError)}`);
    return failure("Could not check for an existing candidate, so nothing was created.");
  }

  const match = resolveCandidateMatch({
    email: typed.email,
    phone: typed.phone,
    existing: (existingRows ?? []) as {
      id: string;
      name: string | null;
      email_normalized: string | null;
      phone_normalized: string | null;
    }[],
  });

  /*
    AN AMBIGUOUS MATCH RESOLVES NOTHING, exactly as it does for bulk intake.

    The email belongs to one candidate and the phone to another (a shared family
    number, a couple applying to the same firm), or one address is already on two
    records. Guessing merges two real people's histories, which is close to
    unrecoverable by hand — so the answers and the file are kept, the row says
    what happened, and a person decides.
  */
  if (match.kind === "conflict") {
    return {
      status: "needs_attention",
      candidateId: null,
      applicationId: null,
      resumeId: null,
      error:
        "This submission's email and phone number point at different existing candidates, " +
        "so no candidate or application was created. Open the answers and decide who this is.",
    };
  }

  // --- The candidate --------------------------------------------------------
  let candidateId: string;
  let conflictCount = 0;

  if (match.kind === "match") {
    candidateId = match.candidateId;

    const { data: existing } = await admin
      .from("candidates")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", candidateId)
      .maybeSingle();

    if (existing) {
      const candidate = existing as unknown as Candidate;

      /*
        NOTHING IS WRITTEN TO THIS CANDIDATE. Two separate disagreements are
        counted so the recruiter can be told there is something to look at:

          - the PARSED resume vs the profile, which Module 6's review screen
            already handles (the proposal is queued below with reviewed_at null)
          - the TYPED answers vs the profile, which no existing screen covers,
            so the response row is flagged and the answers card shows both
      */
      const parsedConflicts = parsed
        ? buildFieldComparisons(candidate, parsed).filter(
            (comparison) => comparison.status === "conflict"
          ).length
        : 0;

      const typedConflicts = typedProfileConflicts({
        typed,
        existing: candidateProfileValues(candidate),
      }).length;

      conflictCount = parsedConflicts + typedConflicts;
    }
  } else {
    const created = await createCandidate({
      admin,
      organizationId,
      typed,
      parsed,
    });
    if (!created) return failure("Could not create a candidate from this submission.");
    candidateId = created;
  }

  // --- The resume row ------------------------------------------------------
  const resumeId = file
    ? await fileResume({
        admin,
        organizationId,
        candidateId,
        file,
        parkedPath: parked,
        parsed,
        extractedCharacters,
        parseError: parseNote,
      })
    : null;

  // --- The application ----------------------------------------------------
  //
  // The SHARED helper, not a copy of it: same double guard against applying
  // twice, same 23505 race handling (a phone user double-tapping Submit is the
  // likeliest way that race ever happens), same acknowledgement message, same
  // automation dispatch.
  const application = await ensureApplicationForCandidate({
    organizationId,
    organizationName,
    candidateId,
    jobId,
    actorId: null,
    webhookUrl: `${origin}/api/webhooks/bolna`,
    client: admin,
    source: "application_form",
    via: "public_application_form",
  });

  if (!application.applicationId) {
    return {
      status: "needs_attention",
      candidateId,
      applicationId: null,
      resumeId,
      error:
        "The candidate was saved, but adding them to this job failed. " +
        "Add them to the job manually to finish it.",
    };
  }

  await logActivity({
    organizationId,
    entityType: "candidate",
    entityId: candidateId,
    eventType: match.kind === "match" ? "candidate.updated" : "candidate.created",
    actorId: null,
    actorLabel: "Public application form",
    useAdminClient: true,
    metadata: {
      via: "public_application_form",
      matched: match.kind === "match",
      job_id: jobId,
    },
  });

  return {
    status: conflictCount > 0 ? "needs_review" : "linked",
    candidateId,
    applicationId: application.applicationId,
    resumeId,
    error:
      conflictCount > 0
        ? `${conflictCount} ${conflictCount === 1 ? "detail" : "details"} in this submission ` +
          "disagree with the candidate's existing profile. Nothing was overwritten — review and decide."
        : null,
  };
}

/** The profile values typedProfileConflicts() compares against. */
function candidateProfileValues(candidate: Candidate) {
  return {
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    current_company: candidate.current_company,
    current_role: candidate.current_role,
    total_experience_years: candidate.total_experience_years,
    expected_salary: candidate.expected_salary,
    notice_period_days: candidate.notice_period_days,
  };
}

/**
 * Creates a candidate from the typed answers, with parsed resume values filling
 * only the gaps.
 *
 * The same exception createCandidateFromResume() documents applies: this is the
 * one place parsed values reach `candidates` without a review, and it is safe
 * for the same reason — the record does not exist until this call, so there is
 * nothing a human established for a model to damage. Here it is safer still,
 * because the typed answers win wherever both have a value.
 */
async function createCandidate({
  admin,
  organizationId,
  typed,
  parsed,
}: {
  admin: SupabaseClient;
  organizationId: string;
  typed: TypedCandidateFields;
  parsed: ParsedResume | null;
}): Promise<string | null> {
  const merged = mergeWithParsedResume({ typed, parsed });

  const { data, error } = await admin
    .from("candidates")
    .insert({
      organization_id: organizationId,
      name: merged.name,
      email: merged.email,
      phone: merged.phone,
      location: merged.location,
      current_company: merged.current_company,
      current_role: merged.current_role,
      total_experience_years: merged.total_experience_years,
      expected_salary: merged.expected_salary,
      notice_period_days: merged.notice_period_days,
      skills: merged.skills,
      source: "application_form",
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[forms] candidate create failed: ${formatDbError(error)}`);
    return null;
  }

  return (data as { id: string }).id;
}

/**
 * Parks the uploaded file under <org>/_apply/ before the candidate is known.
 *
 * The path's FIRST SEGMENT MUST BE THE ORGANIZATION ID — Module 6's storage
 * policies authorise on it — and `_apply` cannot collide with a candidate id,
 * which is always a UUID. The same trick lib/intake/process.ts's parkFile()
 * uses for a file with nobody to file it under yet.
 */
async function parkFile({
  admin,
  organizationId,
  file,
}: {
  admin: SupabaseClient;
  organizationId: string;
  file: { name: string; type: string | null; buffer: ArrayBuffer };
}): Promise<string | null> {
  const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(-120);
  const path = `${organizationId}/_apply/${crypto.randomUUID()}-${safeName}`;

  const { error } = await admin.storage.from(RESUME_BUCKET).upload(path, file.buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    console.error(`[forms] parking the resume failed: ${formatDbError(error)}`);
    return null;
  }
  return path;
}

/**
 * Moves the parked file under the candidate's folder and records the resumes
 * row, with the AI's proposal attached and UNREVIEWED.
 *
 * Best effort throughout: a storage or bookkeeping failure must not undo a
 * candidate and an application that are already correct. The resume is the
 * least important of the three — losing it costs a re-upload, whereas failing
 * the submission would strand a real application.
 */
async function fileResume({
  admin,
  organizationId,
  candidateId,
  file,
  parkedPath,
  parsed,
  extractedCharacters,
  parseError,
}: {
  admin: SupabaseClient;
  organizationId: string;
  candidateId: string;
  file: { name: string; type: string | null; buffer: ArrayBuffer };
  parkedPath: string | null;
  parsed: ParsedResume | null;
  extractedCharacters: number;
  parseError: string | null;
}): Promise<string | null> {
  if (!parkedPath) return null;

  const baseName = parkedPath.split("/").pop() ?? file.name;
  const finalPath = `${organizationId}/${candidateId}/${baseName}`;

  const { error: moveError } = await admin.storage
    .from(RESUME_BUCKET)
    .move(parkedPath, finalPath);

  // Not fatal. The row is what the product reads, and a file left under
  // _apply/ is still the right tenant's and still readable.
  const storedPath = moveError ? parkedPath : finalPath;
  if (moveError) {
    console.error(`[forms] moving the resume failed: ${formatDbError(moveError)}`);
  }

  const fileHash = await sha256Hex(file.buffer);

  const { data, error } = await admin
    .from("resumes")
    .insert({
      organization_id: organizationId,
      candidate_id: candidateId,
      file_url: storedPath,
      file_name: file.name.slice(-200),
      file_type: file.type || null,
      file_size_bytes: file.buffer.byteLength,
      file_hash: fileHash,
      // Already attempted — recording 'pending' would make the UI offer to
      // parse a file that has been parsed, or re-parse one that cannot be.
      parse_status: parsed ? "parsed" : "failed",
      parse_error: parsed ? null : parseError,
      extracted_characters: extractedCharacters,
      parsed_at: parsed ? new Date().toISOString() : null,
      uploaded_by: null,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[forms] resume record failed: ${formatDbError(error)}`);
    return null;
  }

  const resumeId = (data as { id: string }).id;

  if (parsed) {
    // reviewed_at stays null. THIS is what puts the proposal in Module 6's
    // existing review screen and in the "needs your review" count — the same
    // row shape bulk intake writes, so one review flow covers both.
    const { error: proposalError } = await admin.from("resume_parse_results").upsert(
      {
        organization_id: organizationId,
        resume_id: resumeId,
        raw_json: parsed,
        confidence: parsed.confidence,
        applied_fields: [],
        reviewed_by: null,
        reviewed_at: null,
      },
      { onConflict: "resume_id" }
    );

    if (proposalError) {
      console.error(`[forms] queuing parse result failed: ${formatDbError(proposalError)}`);
    }
  }

  await logActivity({
    organizationId,
    entityType: "resume",
    entityId: resumeId,
    eventType: "resume.uploaded",
    actorId: null,
    actorLabel: "Public application form",
    useAdminClient: true,
    metadata: {
      file_name: file.name.slice(-200),
      candidate_id: candidateId,
      via: "public_application_form",
    },
  });

  return resumeId;
}

/** SHA-256 of the file, the same identity the intake route computes. */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Links the response to what it produced, and records how it went. */
async function markResponse({
  admin,
  responseId,
  organizationId,
  status,
  candidateId = null,
  applicationId = null,
  resumeId = null,
  error = null,
}: {
  admin: SupabaseClient;
  responseId: string;
  organizationId: string;
  status: FormResponseStatus;
  candidateId?: string | null;
  applicationId?: string | null;
  resumeId?: string | null;
  error?: string | null;
}): Promise<void> {
  const { error: updateError } = await admin
    .from("form_responses")
    .update({
      status,
      candidate_id: candidateId,
      application_id: applicationId,
      resume_id: resumeId,
      processing_error: error,
    })
    .eq("id", responseId)
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error(`[forms] linking the response failed: ${formatDbError(updateError)}`);
  }
}
