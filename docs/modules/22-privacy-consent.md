# Module 22 — Privacy, consent & data settings

Organization-level control over how candidate voice-call and interview data is
handled. Ten sections, per the brief.

## Where it lives

The brief asks for this "inside the AI Voice Agent Context/Configuration page".
There is no page by that name — the nearest real surface is `/settings/screening`
(call attempts, retry delay, language, record-by-default). Ten sections bolted
onto it would have made it the longest page in the product by a wide margin, so
it is a sibling in the same settings nav:

| Path | What |
| --- | --- |
| `/settings/privacy` | §1–§10, Owner/Admin only |
| `/settings/screening` | Unchanged, now links to the above |

Every existing settings section is one page in that nav; this follows the
convention rather than inventing a nested one.

## The one thing that is not configurable

**Every screening call states that it is automated and may be recorded.** There
is no setting for that sentence.

This was raised before implementation and the decision was taken to build the
toggles as literally specified. The toggles *are* built literally — §2's consent
gate and §7's AI-processing disclosure both switch fully off. What was not built
is the removal of the baseline disclosure, because capturing audio of somebody
who has not been told is a criminal offence in all-party-consent jurisdictions
(California, Illinois, Massachusetts, Pennsylvania, Washington; unlawful
processing under the GDPR and ePrivacy in the EU), and the person exposed is a
candidate with no account who cannot inspect the configuration.

Re-reading the brief, neither §2 nor §7 actually required covert recording:

- **§2 off** means the agent does not halt for a spoken "yes". The candidate is
  still told, and a refusal still ends the call.
- **§7 off** means the *extra* statement about automated analysis is not read.
  The opening disclosure is a different sentence and still happens.

So the gap between the brief and what shipped is one sentence, not a section.

**If you want it removed anyway**, it is one function and one test:

- `buildConsentDisclosure()` in `lib/screening/script.ts` — the sentence
- `assertScriptIsCompliant()` in the same file — the pre-dial check
- `lib/privacy/settings.ts` → `recordingRequiresDisclosure()` — the named
  invariant, which exists so this decision has to be made deliberately
- `lib/screening/screening.test.ts` → "consent disclosure is mandatory and
  cannot be removed"
- `lib/privacy/privacy.test.ts` → "recording is gated on disclosure"

Also note the public site currently states this publicly (`/product/screen`,
`/how-it-works#ai-safety`, the FAQ). Removing the guarantee makes those claims
false and they would need retracting in the same change.

## What shipped

| Path | What |
| --- | --- |
| `lib/privacy/settings.ts` | The config model — all 9 configurable sections, defaults, clamps, invariants |
| `lib/privacy/consent.ts` | §2 consent resolution, §7 disclosure segments, `mayCaptureAudio` |
| `lib/privacy/retention.ts` | §5 expiry decisions, orphan detection, §6 withdrawal resolution |
| `lib/privacy/providers.ts` | §8 processor register |
| `lib/privacy/queries.ts` | §10 log reads, retention dry-run |
| `lib/privacy/privacy.test.ts` | 68 tests |
| `app/settings/privacy/page.tsx` | The page, with §8 and §10 server-rendered |
| `app/settings/privacy/PrivacyForm.tsx` | §1–§7 and §9 |
| `supabase/migrations/0032_module21_privacy_consent.sql` | Column, enum value, consent provenance, trigger, indexes |

Touched: `lib/settings/queries.ts` (carries `privacy_settings`),
`lib/activity/{events,types}.ts` (11 privacy events, `privacy` entity),
`lib/screening/script.ts` (accepts privacy segments), `lib/screening/retry.ts`
(`consent_declined` is terminal), `app/settings/SettingsShell.tsx` (nav),
`app/settings/screening/ScreeningForm.tsx` (cross-link).

### Design decisions worth knowing

**Recording defaults OFF.** The brief's own checkbox list has "Store Audio
Recording" unticked while the other five are ticked. A default of true would
start recording members of the public on a fresh install because nobody had
opened this page yet.

**Expiry defaults to manual review, not delete.** Automatic deletion is a fine
choice; it is not a safe thing to choose on a customer's behalf before they have
seen the page. `getOrganizationSettings` already documents the same instinct for
the older retention block.

**All three candidate rights default ON.** Access, erasure and withdrawal are
rights the GDPR grants whether or not a product has a switch. Defaulting them off
would ship a product configured to refuse lawful requests.

**Metadata cannot be switched off.** It carries consent status. An organization
without it could not honour a refusal, stop re-dialling, answer a subject access
request, or produce the §10 log.

**Rule 5 is enforced in three places, not one.** "If recording is disabled, do
not accidentally create or retain recordings":
- `normalizePrivacySettings` cannot *store* `audioRecording: true` with recording off
- `resolveDataCollection` cannot *report* it as allowed
- a DB trigger refuses to *write* a `recording_url` on a call where recording was
  not permitted

The trigger matters because `AGENTS.md` is right that the browser holds an
authenticated PostgREST client — and the writer here is a webhook driven by an
external provider's payload. A rule living only in that handler is not enforced.

**`consent_declined` is a status, not a failure.** Filing a lawful, correctly
handled refusal under `failed` would feed it to the retry policy, the dashboard
counts and the analytics funnel as a technical fault to be retried. It is now
terminal in `TERMINAL_STATUSES`, so every scheduling path inherits "never dial
again".

**Sarvam AI is not listed in §8.** The brief's example names it for speech
processing. There is no Sarvam adapter in `lib/integrations/` — speech is handled
inside Bolna's platform — so listing it would tell an organization it shares
candidate voice data with a company it has no relationship with. A false entry in
a processing register is worse than a missing one. A test asserts the list matches
the adapters that exist.

**No Interviewer role.** The brief names Admin / Recruiter / Interviewer /
Viewer. `ORG_ROLES` is owner / admin / recruiter / viewer. Adding a role means new
RLS across every table — a different module — so Interviewer maps onto
`recruiter`, whose interview access is already scoped to their own interviews.

**A Viewer can never be granted** recording download, deletion, or candidate
export, whatever is stored in the JSONB. The lowest-trust seat — often a client
contact — must not be the most dangerous one.

## Verified

```
npm run lint       clean
npm run typecheck  clean
npm test           55 files, 1359 tests passed (68 new)
npm run build      succeeded
```

Live: `/settings/privacy` returns 307 → `/login` while anonymous, with `next`
preserved. The public site's disclosure claims still hold.

## Not built yet

The configuration layer, the decision logic, the schema and the UI are complete.
The **enforcement wiring into existing call sites is not**, and none of it is
started — this is the honest boundary of this module:

- **The retention executor.** `planRetentionActions()` and
  `findOrphanedArtifacts()` decide what should happen and are tested; nothing
  carries it out. There is no scheduled sweep, so **no data is being deleted or
  archived on expiry today** — rule 6 is specified and planned, not yet acting.
  The dry-run is what the settings page reads.
- **§9 enforcement at each call site.** `canUseCapability()` is the single source
  of truth and is tested, but the transcript view, recording player, delete
  buttons and export actions do not consult it yet. Their existing Owner/Admin
  checks still apply, so nothing is *more* exposed than before — the finer matrix
  simply is not consulted.
- **§10 event emission.** All 11 event types exist and the log renders them, but
  only events already emitted by Modules 8–14 appear. `privacy.transcript_viewed`,
  `privacy.recording_viewed`, `privacy.data_exported` and
  `privacy.data_deleted` need a `logActivity()` call at their respective actions.
  Until then the log is real but incomplete, which is why the read failure path
  renders an error rather than an empty list.
- **§6 request handling.** The toggles and the withdrawal resolution exist; there
  is no candidate-facing endpoint to *make* a deletion, export or withdrawal
  request, and no queue for staff to work them.
- **Rule 8 confirmation dialogs.** Nothing destructive is wired up yet, so there
  is nothing to confirm. They belong with the delete/export actions above.
- **The webhook path.** `app/api/webhooks/bolna/route.ts` still uses the Module 8
  consent logic. It needs to call `resolveConsentOutcome()`, write
  `consent_mode` / `consent_declined_at` / `recording_permitted`, set
  `consent_declined` status, and apply the decline policy. The DB trigger already
  refuses an unpermitted recording, so the failure mode today is a loud error, not
  a silent capture.
