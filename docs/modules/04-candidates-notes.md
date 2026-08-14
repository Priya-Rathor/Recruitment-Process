# Module 4 (Candidates) — implementation notes and follow-ups

## Design decisions worth knowing

**Deduplication is deterministic, never AI.** Whether two strings are the same
contact is a checkable fact, so it lives in code (`lib/candidates/dedupe.ts`).
Email is lowercased and trimmed; phone is reduced to digits and compared on the
last 10, so `+91 98765 43210`, `098765 43210` and `9876543210` are one person.

The same normalisation is duplicated in a database trigger
(`normalize_candidate_contact()` in migration 0003) because a direct PostgREST
write would otherwise create a record that silently escapes detection. **If you
change one, change the other** — `lib/candidates/dedupe.ts` has the tests, the
trigger has the enforcement.

**A suspected duplicate warns, it does not block.** The same person legitimately
re-applies, and blocking would strand a real candidate. `POST /api/candidates`
returns `409 duplicate_suspected` with the matches; the recruiter can open the
existing record or pass `acknowledge_duplicates: true` to continue. Either way
the pairing is recorded in `candidate_duplicates` for review. Nothing is ever
auto-merged: merging two people's histories wrongly is far worse than carrying a
duplicate for a day.

**Natural-language search translates to filters, never to rows.**
`parseCandidateSearch()` returns a `CandidateFilters` object; `listCandidates()`
then executes it — the exact same function the manual filter UI calls. That is
what makes the spec's test ("natural-language search returns results matching
literal filter equivalents") true by construction. A model that returned
candidate ids could not guarantee it, and an AI outage would produce wrong
people on screen instead of a clean fallback to the manual filters.

The inferred filters are shown back to the recruiter above the results, so a
misreading is visible and correctable rather than silently trusted.

## Deliberately NOT built

- **Consent capture** (`consent_given_at`, `consent_version`). The Privacy &
  Compliance chapter assigns these to Module 4, but stages them as a retrofit
  once Modules 1, 4, 8, 14 and 17 all exist. Kept out of scope here to match the
  spec's staging — but note that the intake paths built in this module are
  exactly what that retrofit must hook into.
- **Hard deletion.** `DELETE /api/candidates/:id` archives. True erasure must
  clear resumes, screening transcripts and notes in one audited operation, which
  is the retrofit's job.
- **LinkedIn / job-board ingestion** and **advanced fuzzy dedup** — both
  explicitly Build Later.
- **Resume file parsing** — Module 6. This module handles free-text paste only.

## Follow-ups

- ☐ **Module 5 (Applications)**: the candidate detail page has an "Applications"
  placeholder card. Replace it with the real per-candidate history across jobs —
  the spec's "candidate detail view showing full history across jobs/applications".
- ☐ **Module 6 (Resume AI)**: add resume upload to the detail page and write
  confirmed fields back here. `resume_url` already exists on the table.
- ☐ **Module 14 (Activity & Audit)**: three `TODO(Module 14)` markers in
  `app/api/candidates/*` need real `logActivity()` calls. The privacy chapter
  additionally requires logging "candidate profile viewed" events.
- ☐ **Duplicate resolution UI**: `candidate_duplicates` rows can be created and
  displayed, but there is no confirm/dismiss action yet — the `status` enum and
  `reviewed_by`/`reviewed_at` columns exist for it.
- ☐ **Pagination on the candidates list page**: the API paginates, but the page
  currently renders the first 50 and shows "Showing 50 of N". Fine at MVP data
  volumes; revisit before the spec's 10,000-row target.
- ☐ **Cost guard**: `POST /api/candidates/search` calls the LLM on every submit
  with no cache. The AI & Calling Cost Model chapter wants a short response
  cache keyed on the query — add it with that retrofit.
