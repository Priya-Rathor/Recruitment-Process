Data Privacy & Compliance
This platform collects and processes personal data about real people who did not necessarily choose to interact with your software directly — candidates. It also records phone calls. This section is not optional polish; get it wrong and you have a legal problem, not just a product gap. Treat it as a cross-cutting requirement that Modules 1, 4, 6, 8, 9, 14, and 17 must all implement pieces of — it is not a standalone module.
Why This Matters For This Specific Product
	•	Candidates do not sign up for your product — they are added by recruiters, often without being in the room. Consent and notice obligations exist even though the candidate is not your direct user.
	•	Module 8 (Bolna AI Screening) records phone calls. Call recording without consent is illegal in many jurisdictions, independent of any data-protection law.
	•	You store resumes, salary expectations, notice periods, and sometimes personal circumstances (relocation, family) — all personal data, some of it sensitive depending on jurisdiction.
	•	You are a data fiduciary/controller for every organization's candidates, and each organization (your tenant) is itself a data fiduciary/controller for its own candidates and clients.
Applicable Law — What To Actually Build Against
India — Digital Personal Data Protection Act (DPDP), 2023 (primary, since this spec targets an Indian recruitment stack):
	•	Notice and consent before collecting personal data, in clear language, at or before first collection (career-page application, resume upload, or the AI screening call).
	•	Purpose limitation: data collected for recruitment (this job, this candidate) should not be silently reused for an unrelated purpose (e.g. marketing) without fresh consent.
	•	Data minimization: only collect fields the module actually needs (see each module's data model — do not add speculative fields 'in case we need them later').
	•	Right to access, correction, and erasure: a candidate (via the organization, or eventually a self-serve request) can ask what data you hold and ask for it to be corrected or deleted.
	•	Breach notification obligations to the Data Protection Board and affected individuals within a prescribed timeframe.
	•	Data Protection Officer / grievance-redressal contact point once you cross the applicable size/sensitivity thresholds — track this as you grow, not required at MVP scale.
If/when you take on EU or UK clients — GDPR / UK GDPR:
	•	Lawful basis for processing (typically 'legitimate interest' for recruitment, but document it per organization).
	•	Data Processing Agreements (DPAs) with every sub-processor whose API touches personal data — this specifically means your LLM provider and Bolna. Confirm each one offers a DPA before sending candidate PII to it.
	•	Data residency/cross-border transfer safeguards if candidate data leaves the EU/UK (it will, if you call a US-hosted LLM or calling provider) — Standard Contractual Clauses or equivalent.
	•	Data Protection Impact Assessment (DPIA) if you process data at scale or process special-category data (e.g. health/disability mentioned in a resume) at any meaningful volume.
Concrete Build Requirements (map to existing modules)
Requirement
Owning Module
What to actually implement
Consent notice on career page / candidate intake
Module 4 (Candidates)
Show a short notice + link to a privacy policy before the candidate's data is submitted; store consent_given_at and consent_version on the candidate record
Verbal consent at the start of every AI screening call
Module 8 (Bolna Screening)
The call script's opening line must state that the call is automated and may be recorded, and the candidate's continuation is treated as consent; store consent_confirmed boolean + timestamp on screening_calls
Retention limits enforced, not just configured
Module 17 (Settings) + a scheduled job
retention_settings already exists in organization_settings (see Module 17) — this requires an actual scheduled deletion/anonymization job, not just a stored number
Right-to-erasure request handling
Module 4 (Candidates) + Module 14 (Audit)
An admin-facing 'Delete Candidate Data' action that removes/anonymizes PII across candidates, resumes, screening_calls (transcript+recording), application_notes, while preserving anonymized aggregate stats already counted in Analytics; log the erasure itself to activity_events
Sub-processor disclosure
Module 17 (Settings)
List which third parties (LLM provider, Bolna, email provider, calendar provider) process candidate data, visible to Owner/Admin, ideally with links to each provider's own DPA
Access log for who viewed sensitive candidate data
Module 14 (Audit)
Extend the activity_events logging already required in Module 14 to include 'candidate profile viewed' / 'screening report viewed' events, at least for Viewer-role access
What NOT To Build At MVP (avoid scope creep here too)
	•	A full self-serve candidate data portal (nice later; an admin-triggered erasure/export action is enough for MVP)
	•	Automated DPIA tooling
	•	Multi-jurisdiction consent-language localization beyond English/Hindi
	•	A dedicated consent-management platform — a stored timestamp + version string per consent event is sufficient at this scale
Claude Implementation Prompt — Privacy & Compliance Retrofit
Save this specification as /docs/modules/00-privacy-compliance.md, then give Claude the prompt below once Modules 1, 4, 8, 14, and 17 already exist:
Implement the Data Privacy & Compliance requirements for my multi-tenant recruitment SaaS across the existing Modules 1, 4, 8, 14, and 17.
 
Read /docs/modules/00-privacy-compliance.md, and the existing Modules 1, 4, 8, 14, 17 code before making changes — this is a retrofit across already-built modules, not a new standalone module.
 
Implement:
- candidates.consent_given_at (timestamptz, nullable) and candidates.consent_version (text) — set when a candidate is created via any intake path in Module 4; block AI processing (resume parsing, matching) on a candidate record with no consent timestamp unless the organization has explicitly marked that intake source as pre-consented (e.g. agency database migrations)
- screening_calls.consent_confirmed (boolean) and screening_calls.consent_confirmed_at (timestamptz) in Module 8; update the Bolna call script's opening line to state the call is automated and may be recorded, and require this field to be true before a transcript/recording is treated as usable in Module 9
- A scheduled job (daily) that reads organization_settings.retention_settings (already defined in Module 17) and hard-deletes or anonymizes call recordings/transcripts and archived candidate PII past the configured retention window; log every deletion to activity_events (Module 14)
- An admin-only 'Delete Candidate Data' action on the candidate detail page (Module 4) that removes/anonymizes PII across candidates, resumes, screening_calls (transcript + recording_url), and application_notes for that candidate, while leaving already-aggregated Analytics counts (Module 16) intact; log the erasure to activity_events
- A 'Sub-processors' read-only list on the Security settings page (Module 17) naming the LLM provider, Bolna, the email provider, and the calendar provider as data processors
- Extend Module 14's activity logging to record 'candidate profile viewed' and 'screening report viewed' events, including the viewer's role
 
Do not build a full self-serve candidate portal, automated DPIA tooling, or multi-language consent localization beyond English/Hindi at this stage.
 
Test: consent blocks AI processing until given (except pre-consented intake sources), retention job actually deletes/anonymizes past the configured window, erasure action removes PII from every listed table without breaking existing Analytics aggregates, sub-processor list is visible only to Owner/Admin, new activity_events entries are created for every action above.
 
At completion report: files created/modified, schema changes, the scheduled job's mechanism (cron/edge function/etc.), which existing AI calls now check consent before running, and remaining legal/compliance items you were not able to fully automate (e.g. anything requiring a human policy decision).

