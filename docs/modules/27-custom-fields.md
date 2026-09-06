# Module 27 — Custom Fields

Per-organization extra fields on **jobs, candidates and applications**, with no
code change and no per-organization schema migration.

> **Numbered 27, not 19.** The brief called this "Module 19", but Module 19 is
> Onboarding & Document Management (`19-onboarding-documents.md`, migration
> `0026_module19_onboarding_documents`). Two modules sharing a number would make
> every later cross-reference ambiguous. Likewise the brief's "Module 18's
> `form_fields`" is Module 23 (`0033_module23_forms_public_applications`) —
> Module 18 is bulk resume intake. The taxonomy referred to is the right one; only
> the numbers were off.

## The one decision everything else follows from

**Fixed fields stay fixed. Custom fields are additive, and the database enforces
it.**

Nothing in `jobs`, `candidates` or `applications` was altered, renamed or
re-typed. The migration creates two tables and touches nothing else. Critically,
a custom field cannot be *named* after a built-in one: migration 0039 carries a
`CHECK` listing every reserved key per entity, so `email` on a candidate is
refused by Postgres — not merely by a route handler that a signed-in user could
bypass through PostgREST.

That constraint is what keeps migration 0023's rule intact. A candidate's name,
email and phone remain editable only from the Candidate page, and no custom field
can become a second, differently-permissioned door to them.

## Data model

`custom_field_definitions` — the vocabulary. `custom_field_values` — one answer
per definition per record, `value` as `jsonb`.

Two deviations from the brief's schema, both deliberate:

- **`custom_field_values.organization_id`** was added. Every RLS policy would
  otherwise have to join to the definition to learn the tenant, and AGENTS.md
  rule 8 requires admin-client queries to filter `organization_id` explicitly —
  impossible on a table that does not carry it. A trigger keeps it honest against
  the definition rather than trusting the caller.
- **`display_order`, not `order`** — `order` is a SQL reserved word, and
  `display_order` is what `organization_document_templates` already uses.

`entity_id` is **polymorphic**, so there is no foreign key. Three `AFTER DELETE`
triggers stand in for `ON DELETE CASCADE`. They fire on hard delete only:
archiving a job keeps its values, which is correct.

## One field-type taxonomy

`field_type` is `public.form_field_type` — the **enum Module 23 already created**,
not a new one. `CUSTOM_FIELD_TYPES` in `lib/customFields/definitions.ts` is
`FORM_FIELD_TYPES.filter(...)`, derived rather than retyped, so a new forms type
appears here automatically unless explicitly excluded.

Three of the twelve are excluded, by `CHECK` and in code:

| Excluded | Why |
| --- | --- |
| `email`, `phone` | Identity has one home. A custom email field would be a second address disagreeing with `candidates.email`, editable from a page the real one is not. |
| `file_upload` | No bucket, no storage policy, no Module 22 retention answer. `lib/forms/fields.ts` already refuses it for the same reason. |

## The public-form distinction

A job field with `show_on_public_form` is asked of **every applicant**. The
DEFINITION belongs to the job; each VALUE belongs to the application that came
through the form. Storing those answers on the job would mean every candidate
overwriting the last one's.

So `custom_field_values.entity_type` is `'application'` while the definition's is
`'job'` — **the one permitted mismatch**, allowed explicitly by the integrity
trigger and nowhere else. Answers keep their prefixed key (`custom__<key>`) in
`form_responses.raw_answers` as the immutable record of what was typed, while
`custom_field_values` holds the current value a recruiter may later correct.

## Placeholders

Tokens are three-part: `{{custom.job.visa_sponsorship}}`. Two parts would be
ambiguous, because `field_key` is unique per *(organization, entity_type)* and a
"region" field may exist on both jobs and candidates.

`TOKEN_PATTERN` was widened to allow a third segment and digits (`uniqueFieldKey`
appends `_2`). Backward-compatible: two-segment tokens still match, and an
unrecognised token is still returned verbatim.

**A public-form job field prefers the applicant's own answer**, falling back to
the job's. These messages are written *to* a candidate, so "you told us you need
sponsorship" must not print what the job requires instead.

## Permissions

| | Definitions | Values |
| --- | --- | --- |
| Owner / Admin | full | full |
| Recruiter | read | full |
| Viewer | read | read |

Enforced in the API *and* in RLS.

## Deleting

`DELETE` **deactivates** (`active = false`) and the dialog names the count of
records holding data. `?permanent=true` erases, and is refused server-side the
moment one value exists.

The brief's wording ("restore by re-adding a field with the same key") does not
match soft delete — the row still holds that key, so re-adding would collide.
Turning it back **on** is what restores it, and that is what the UI offers.

## Gaps, deliberately

- **Analytics is untouched**, per the brief's §5.
- **Clients, interviews and every other entity** are out of scope, per §7.
- **`show_on_public_form` is org-wide**, not per job: the definition carries no
  `job_id`. A per-job override would need a third table.
- **No help text** on a custom field — `form_fields` has `help_text`; this does
  not. Nothing in the brief asks for it.
