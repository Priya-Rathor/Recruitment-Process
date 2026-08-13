AI & Calling Cost Model
Every AI Service Layer function costs money per call (LLM tokens), and every Bolna screening call costs money per minute. With zero cost tracking, a bug in Module 13's automation (e.g. an infinite retry loop, or a rule that re-screens the same candidate on every stage re-entry) can quietly run a large bill before anyone notices. This section adds a cost ledger and budget guardrails as a cross-cutting layer under the AI Service Layer and Bolna adapter already specified in Modules 6-13 and 17.
Cost Drivers In This Product
AI Feature
Module
Cost Type
Note
Resume parsing
Module 6
LLM tokens
High volume, low complexity — use a cheaper/smaller model
Candidate-to-job matching
Module 7
LLM tokens
Medium volume — runs on create + on relevant data change, not on every page view
Bolna screening call
Module 8
Per-minute call cost + LLM tokens for the conversation
Highest single-event cost — cap attempts (already specified as a retry policy) doubles as a cost cap
Screening summarization
Module 9
LLM tokens
One call per completed screening — cheap relative to the call itself
Interview brief generation
Module 11
LLM tokens
Low volume (once per scheduled interview)
Client submission drafting
Module 12
LLM tokens
Low volume, recruiter-triggered
Pipeline attention summary / Ask Pipeline AI
Module 10
LLM tokens
Can be called repeatedly by an impatient user — needs a short cache/cooldown
Activity narrative summary
Module 14
LLM tokens
Low volume, on-demand
Analytics explanation / Ask Analytics AI
Module 16
LLM tokens
Can be called repeatedly — cache per date-range+filter combination
Automation-drafting assistant
Module 13
LLM tokens
Rare (setup-time only)
Cost Ledger — Add This Table
	•	ai_usage_events (id, organization_id, module, function_name, provider, model, tokens_in, tokens_out, estimated_cost, application_id NULL, created_at) — every AI Service Layer function call writes one row here, success or failure
	•	call_usage_events (id, organization_id, screening_call_id, provider ('bolna'), duration_seconds, estimated_cost, created_at) — every Bolna call attempt writes one row here regardless of outcome
Budget Guardrails (extend Module 17 Settings)
	•	organization_settings gets an additional ai_budget_settings JSONB field: monthly_budget_cap, alert_threshold_pct (default 80), hard_stop_enabled (boolean)
	•	When cumulative estimated_cost for the current month crosses alert_threshold_pct, trigger an in-app + email notification (reuses Module 15's send pipeline) to Owner/Admin
	•	If hard_stop_enabled is true and the cap is reached, AI Service Layer functions return a clear 'AI budget exceeded — process manually or contact your admin' response instead of silently failing or silently continuing to spend; the underlying business action (e.g. reviewing a resume) must still be completable manually
	•	Never hard-stop the Bolna call retry policy or interview scheduling purely on cost grounds without a clear, visible warning first — a silent stop looks like a bug, not a budget control
De-duplication & Caching Guardrails
	•	Do not re-run resume parsing if the resume file hash is unchanged since the last successful parse
	•	Do not recalculate a match score on every page view — only on creation and on the specific data changes already defined in Module 7's spec
	•	Cache 'Ask Pipeline AI' and 'Ask Analytics AI' responses for a short window (e.g. 2-5 minutes) keyed on the exact query + filter state, so a user clicking repeatedly doesn't multiply cost
	•	An automation (Module 13) must not be able to trigger the same AI action on the same application more than once per stage-entry — guard this at the automation-run level, not just in the AI function itself
Cost Visibility (extend Module 16 Analytics)
	•	Add an 'AI & Screening Cost' tab or card: total estimated AI cost this period, cost by function (resume parsing / matching / screening / summarization / briefs), estimated cost per hire, Bolna minutes used and estimated call cost
	•	Label every figure here 'Estimated' exactly as Module 16 already does for 'Screening Time Saved' — these are estimates based on provider list pricing, not exact invoiced amounts
Claude Implementation Prompt — Cost Tracking & Budget Guardrails Retrofit
Save this specification as /docs/modules/00-cost-tracking.md, then give Claude the prompt below once the AI Service Layer (Module 6+) and Modules 15, 16, 17 already exist:
Implement AI & Calling Cost Tracking and budget guardrails for my multi-tenant recruitment SaaS, as a cross-cutting layer under the existing AI Service Layer and Bolna adapter.
 
Read /docs/modules/00-cost-tracking.md and the existing AI Service Layer, Module 8 (Bolna), Module 15 (Notifications), Module 16 (Analytics), and Module 17 (Settings) code before making changes.
 
Implement:
- ai_usage_events and call_usage_events tables with RLS, organization-scoped
- A shared wrapper around every existing AI Service Layer function call that logs tokens_in/tokens_out/estimated_cost to ai_usage_events on every call, success or failure — do not require each function to log itself individually; wrap once at the call boundary
- A similar wrapper around Module 8's placeCall() that logs duration and estimated_cost to call_usage_events for every attempt
- ai_budget_settings JSONB field on organization_settings (monthly_budget_cap, alert_threshold_pct default 80, hard_stop_enabled) with a Settings UI section under Module 17
- A scheduled or on-write check that sends an alert (via Module 15's existing notification pipeline) to Owner/Admin when the alert threshold is crossed for the current month, and enforces the hard stop (returning a clear, user-visible 'AI budget exceeded' result rather than a silent failure) when hard_stop_enabled and the cap is reached — the underlying manual workflow must remain usable when AI is blocked
- De-duplication guards: skip re-parsing a resume with an unchanged file hash; skip re-running a match score outside the triggers already defined in Module 7; add a short response cache (2-5 minutes) for Ask Pipeline AI and Ask Analytics AI keyed on query+filters; prevent Module 13 automations from re-triggering the same AI action on the same application within the same stage-entry
- A new 'AI & Screening Cost' section in Module 16 Analytics showing total estimated cost this period, cost by function, estimated cost per hire, and Bolna minutes/cost, all explicitly labeled 'Estimated'
 
Do not build exact invoice reconciliation with provider billing APIs at this stage — estimated cost from token/duration counts and known list pricing is sufficient.
 
Test: every AI call and every Bolna call attempt produces exactly one usage-log row; budget alert fires at the configured threshold; hard stop blocks the AI action but not the manual fallback; de-duplication guards actually prevent the specific repeat-call scenarios described above; Analytics cost figures match the sum of the underlying usage tables for the selected date range.
 
At completion report: files created/modified, schema changes, which AI Service Layer functions/Bolna calls are now wrapped, budget-guardrail logic, de-duplication guards implemented, Analytics changes, tests, remaining issues.

