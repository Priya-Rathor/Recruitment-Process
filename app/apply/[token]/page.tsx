// =============================================================================
// /apply/{token} — the one page somebody who has never heard of this product
// ever sees.
//
// NO SESSION, NO NAV, NO APP SHELL. The reader is applying for a job, not using
// a recruitment dashboard. Wrapping their application in one would offer them
// links they cannot open — the same call /unsubscribe and /coding already made.
//
// The token is verified SERVER-SIDE before anything renders, so a form that is
// closed, unknown or superseded never ships a single input to the browser.
//
// MOBILE IS THE PRIMARY CASE, NOT THE FALLBACK. This link arrives on WhatsApp
// and LinkedIn, and it is opened on a phone on the way somewhere. The layout is
// a single column that happens to have a wider maximum on a desktop.
// =============================================================================
import { AlertCircle, Briefcase, MapPin, Clock } from "lucide-react";
import { Logo } from "@/components/Logo";
import { loadPublicForm } from "@/lib/forms/public";
import { WORK_MODE_LABELS, isWorkMode } from "@/lib/types";
import { ApplyForm } from "./ApplyForm";

export const metadata = { title: "Apply" };
/**
 * Never cached. A recruiter can disable the form or regenerate the link while
 * somebody is reading it, and a cached render would keep handing out a form
 * that no longer accepts anything.
 */
export const dynamic = "force-dynamic";

export default async function ApplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadPublicForm(token);

  if (!result.ok) return <ClosedCard message={result.message} />;

  const { view } = result;
  const experience = formatExperienceBand(view.job?.experienceMin, view.job?.experienceMax);
  const workMode = view.job?.workMode;

  return (
    <main className="apply-page">
      <div className="apply-page__brand">
        <Logo variant="compact" height={24} priority />
      </div>

      <div className="apply-shell">
        <header className="apply-hero">
          {view.organizationName && <p className="apply-hero__org">{view.organizationName}</p>}
          <h1 className="apply-hero__title">{view.job?.title ?? view.name}</h1>

          {/* The read-only context: enough for somebody to know whether this is
              the role they meant to apply for, and nothing about the pipeline. */}
          <div className="apply-hero__facts">
            {view.job?.location && (
              <span className="apply-fact">
                <MapPin size={14} aria-hidden="true" />
                {view.job.location}
              </span>
            )}
            {workMode && isWorkMode(workMode) && (
              <span className="apply-fact">
                <Briefcase size={14} aria-hidden="true" />
                {WORK_MODE_LABELS[workMode]}
              </span>
            )}
            {experience && (
              <span className="apply-fact">
                <Clock size={14} aria-hidden="true" />
                {experience}
              </span>
            )}
          </div>

          {view.description && <p className="apply-hero__intro">{view.description}</p>}
        </header>

        <ApplyForm token={token} fields={view.fields} privacyNotice={view.privacyNotice} />
      </div>
    </main>
  );
}

/**
 * Every refusal, as one card.
 *
 * ONE MESSAGE, ONE SHAPE, whether the link was disabled, never existed or was
 * regenerated away — the wording comes from lib/forms/public.ts, which is where
 * the decision about what to reveal is made. Never a raw 404 and never a stack
 * trace: the reader has no account and no support channel here, so the only
 * useful thing to say is "go back to whoever sent you this".
 */
function ClosedCard({ message }: { message: string }) {
  return (
    <main className="auth-layout">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo variant="full" height={44} priority />
        </div>

        <div className="card">
          <p className="coding-closed__icon" aria-hidden="true">
            <AlertCircle size={28} />
          </p>
          <h1 className="title is-5 mb-2">This application isn&apos;t open</h1>
          <p className="has-text-secondary" style={{ fontSize: 14 }}>
            {message}
          </p>
        </div>
      </div>
    </main>
  );
}

/** "2–5 years experience", or nothing at all when the job does not say. */
function formatExperienceBand(min?: number | null, max?: number | null): string | null {
  if (min === null || min === undefined) {
    return max === null || max === undefined ? null : `Up to ${max} years experience`;
  }
  if (max === null || max === undefined) return `${min}+ years experience`;
  if (min === max) return `${min} years experience`;
  return `${min}–${max} years experience`;
}
