# Module 6 (Resume AI) — implementation notes and follow-ups

## The pattern this module was meant to establish

The spec calls `parseResume()` "the FIRST AI Service Layer function in the
product" and says the propose → validate → human-review → save pattern must be
created here for every later AI function to copy.

In this build that pattern was already established in Modules 1–5 —
`lib/ai/provider.ts` is the single provider boundary, and
`mergeProposal()` (Module 3) / `mergeCandidateProposal()` (Module 4) are the
propose-then-review helpers. **`parseResume()` follows it exactly rather than
inventing a variant**, which is the outcome the spec wanted.

## Where the safety property actually lives

`lib/resumes/review.ts`. The spec's two tests for this module are:

- "Recruiter's chosen value always wins over the AI proposal once confirmed"
- "No AI output is written to the candidate profile without a review step"

Both are properties of `applyReviewDecisions()`:

- A field with **no decision is never written**. Doing nothing changes nothing.
- `"keep"` is not an update — it explicitly preserves the stored value.
- `"accept"` is honoured only when the resume actually proposed something, so a
  stray decision cannot blank a stored field with `null`.
- The decisions payload names **fields, never values**, so there is no path from
  a request body to an attacker-chosen candidate value. Values can only come
  from the stored parse result.

Structurally, `POST /api/resumes/:id/parse` writes to `resume_parse_results` and
**cannot touch `candidates` at all**. `POST /api/resumes/:id/review` is the only
route in the module that updates the candidate.

The UI reinforces it: a **conflict defaults to "keep"**, a **new (blank-profile)
value defaults to "accept"**. The risky action needs an explicit click; the safe
one doesn't.

## Extraction

`unpdf` for PDF, `mammoth` for DOCX, plain decode for text. Every path returns a
result rather than throwing, per "graceful partial results".

The failure worth calling out is the **scanned/image-only PDF**: it yields almost
no text, and passing that to the model would make it hallucinate while the
recruiter blamed the AI. Detected as its own `no_text_layer` reason with a
message naming the fix. OCR at scale is Build Later per the spec.

Legacy `.doc` is rejected rather than half-read — mammoth cannot parse the old
binary format, and mojibake would be worse than a clear refusal.

## Storage

Private `resumes` bucket. Resumes are personal data and must never be readable by
URL, so downloads go through short-lived signed URLs issued after a tenancy
check.

Object paths are `<organization_id>/<candidate_id>/<uuid>-<filename>`, and the
storage policies authorise on the **first path segment**. Uploads therefore go
through our API route rather than direct-to-storage — the client must not choose
its own path, or it could write into another tenant's folder.

**Setup caveat:** some Supabase projects block `insert into storage.buckets` from
the SQL editor. If migration 0005 errors there, create the bucket by hand
(Storage → New bucket → `resumes`, not public, 10 MB) and re-run the policy
statements at the end of the file. This is noted in the README too.

## Cost guard

`resumes.file_hash` (SHA-256) is stored on upload, and an identical file already
parsed for the same candidate short-circuits before any AI call — the AI &
Calling Cost Model chapter's "do not re-run resume parsing if the file hash is
unchanged" requirement.

## Follow-ups

- ☐ **Experience / education / certifications are parsed but not stored as
  candidate fields.** Module 4's `candidates` table has no columns for them, so
  they live on the parse result and are shown read-only on the review screen,
  explicitly flagged as not searchable. Adding them is a Module 4 schema change,
  not a Module 6 one.
- ☐ **Module 14 (Activity & Audit)** — three `TODO(Module 14)` markers. The
  applied-fields list is already recorded on `resume_parse_results` for audit,
  but the activity log needs the event.
- ☐ **Parsing is synchronous.** `maxDuration = 120` covers a large resume, but a
  bulk upload path would want a queue. Fine at MVP volumes.
- ☐ **OCR for scanned resumes** — Build Later, and the failure message already
  tells the recruiter what to do meanwhile.
- ☐ **Multi-language resumes** — Build Later.
- ☐ **Privacy retrofit** — resumes are among the artefacts the erasure action
  must clear (file object, `resumes` row, `resume_parse_results.raw_json`).
