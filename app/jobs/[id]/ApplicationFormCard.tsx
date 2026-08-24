"use client";

// =============================================================================
// The application form, on the job page.
//
// THIS CARD IS THE WHOLE FEATURE, from a recruiter's point of view: it is where
// a job becomes a link they can put on LinkedIn. So it says exactly one thing at
// a time, depending on which of four states the form is in — draft, published,
// disabled, or not created at all — rather than showing every control greyed out
// and letting the reader work out which apply.
//
// EXPLICIT ACTIONS, NO AUTO-SAVE (the design system's rule). Publishing puts a
// URL on the public internet and disabling takes it away; neither is something a
// mis-click should do silently.
//
// REGENERATE ASKS FIRST. It is the only action here that destroys something
// somebody else holds — a link already forwarded, a QR code already printed —
// and the confirmation says so in those words rather than "are you sure?".
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Link2, QrCode, Settings2 } from "lucide-react";
import { FormError } from "@/components/states";

export function ApplicationFormCard({
  jobId,
  formId,
  status,
  fieldCount,
  submissionCount,
  publicUrl,
  canEdit,
  canRegenerate,
  jobArchived,
}: {
  jobId: string;
  /** Null for a job created before this module, or whose auto-creation failed. */
  formId: string | null;
  status: "draft" | "published" | "disabled" | null;
  fieldCount: number;
  submissionCount: number;
  /** Built server-side, so the token is never assembled in the browser. */
  publicUrl: string | null;
  canEdit: boolean;
  canRegenerate: boolean;
  jobArchived: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  async function patch(body: Record<string, unknown>) {
    if (!formId || busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/forms/${formId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not update the application form.");
        return;
      }
      // Server-rendered page: the new state only becomes visible once the page
      // re-reads it.
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/jobs/${jobId}/application-form`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not create the application form.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses clipboard access (an insecure origin, a locked
      // down device). The link is on screen and selectable, so say that rather
      // than failing silently.
      setError("Couldn't copy automatically — select the link above and copy it.");
    }
  }

  function regenerate() {
    const confirmed = window.confirm(
      "Regenerate the public link?\n\n" +
        "Every link already shared and every QR code already printed will stop working " +
        "immediately. Anyone part-way through the form will lose it. You will need to share " +
        "the new link yourself."
    );
    if (confirmed) void patch({ regenerate_link: true });
  }

  return (
    <section className="card">
      <div className="job-card__head">
        <div>
          <h2 className="job-card__title">
            <Link2 size={16} aria-hidden="true" />
            Application form
          </h2>
          <p className="job-card__subtitle">
            A public page candidates fill in themselves. Every submission creates or matches a
            candidate and adds them to this job&apos;s pipeline.
          </p>
        </div>

        {formId && (
          <Link className="text-link" href={`/settings/forms/${formId}`}>
            <Settings2 size={14} aria-hidden="true" />
            {canEdit ? "Manage questions" : "View questions"}
          </Link>
        )}
      </div>

      <FormError message={error} />

      {/* ---- No form at all --------------------------------------------- */}
      {!formId && (
        <div className="job-empty is-centred">
          <p className="job-empty__text">
            This job has no application form yet — jobs created before this feature existed
            don&apos;t have one.
          </p>
          {canEdit && !jobArchived && (
            <button className="button is-primary" type="button" onClick={create} disabled={busy}>
              Create application form
            </button>
          )}
        </div>
      )}

      {/* ---- Draft ------------------------------------------------------- */}
      {formId && status === "draft" && (
        <>
          <div className="job-stats">
            <div className="job-stats__item">
              <p className="job-stats__label">Status</p>
              <p className="job-stats__value">Draft — not shared yet</p>
            </div>
            <div className="job-stats__item">
              <p className="job-stats__label">Questions</p>
              <p className="job-stats__value">{fieldCount}</p>
            </div>
          </div>

          <p className="job-card__hint">
            The standard questions are already here. Review them, add anything specific to this
            role, then publish to get a link you can share.
          </p>

          {canEdit && (
            <div className="job-card__foot">
              <Link className="button is-quiet" href={`/settings/forms/${formId}`}>
                Review questions
              </Link>
              <button
                className="button is-primary"
                type="button"
                onClick={() => patch({ status: "published" })}
                disabled={busy || fieldCount === 0 || jobArchived}
              >
                Publish
              </button>
            </div>
          )}
        </>
      )}

      {/* ---- Published --------------------------------------------------- */}
      {formId && status === "published" && (
        <>
          <div className="job-stats">
            <div className="job-stats__item">
              <p className="job-stats__label">Status</p>
              <p className="job-stats__value">Open for applications</p>
            </div>
            <div className="job-stats__item">
              <p className="job-stats__label">Applications received</p>
              <p className="job-stats__value">{submissionCount}</p>
            </div>
            <div className="job-stats__item">
              <p className="job-stats__label">Questions</p>
              <p className="job-stats__value">{fieldCount}</p>
            </div>
          </div>

          {publicUrl ? (
            <div className="apply-link">
              <code className="apply-link__url">{publicUrl}</code>
              <div className="apply-link__actions">
                <button className="button is-small is-quiet" type="button" onClick={copyLink}>
                  {copied ? (
                    <>
                      <Check size={14} aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={14} aria-hidden="true" /> Copy link
                    </>
                  )}
                </button>
                <button
                  className="button is-small is-quiet"
                  type="button"
                  onClick={() => setShowQr((current) => !current)}
                >
                  <QrCode size={14} aria-hidden="true" />
                  {showQr ? "Hide QR code" : "Show QR code"}
                </button>
                <a
                  className="button is-small is-quiet"
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} aria-hidden="true" /> Preview
                </a>
              </div>
            </div>
          ) : (
            <p className="job-empty is-warning">
              This form is published but a link could not be built — the server is missing its
              signing key, so nobody can open it. Ask an administrator to set
              INTEGRATION_ENCRYPTION_KEY.
            </p>
          )}

          {showQr && (
            <div className="apply-qr">
              {/* Rendered by an authenticated endpoint, so no QR library reaches
                  the browser and the link is never drawn from client state. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/forms/${formId}/qr`}
                alt="QR code linking to the public application form"
                width={200}
                height={200}
              />
              <p className="apply-qr__hint">
                Print it or drop it into a slide. It stops working if you regenerate the link.
              </p>
            </div>
          )}

          <div className="job-card__foot">
            <Link className="button is-quiet" href={`/applications?job_id=${jobId}`}>
              View applications
            </Link>
            {canEdit && (
              <button
                className="button is-quiet"
                type="button"
                onClick={() => patch({ status: "disabled" })}
                disabled={busy}
              >
                Stop accepting applications
              </button>
            )}
            {canRegenerate && (
              <button
                className="button is-danger-soft"
                type="button"
                onClick={regenerate}
                disabled={busy}
              >
                Regenerate link
              </button>
            )}
          </div>
        </>
      )}

      {/* ---- Disabled ---------------------------------------------------- */}
      {formId && status === "disabled" && (
        <>
          <div className="job-stats">
            <div className="job-stats__item">
              <p className="job-stats__label">Status</p>
              <p className="job-stats__value">Closed to new applications</p>
            </div>
            <div className="job-stats__item">
              <p className="job-stats__label">Applications received</p>
              <p className="job-stats__value">{submissionCount}</p>
            </div>
          </div>

          <p className="job-card__hint">
            Anyone opening the link is told the position is no longer accepting applications. The
            {submissionCount === 1 ? " application" : " applications"} already received are
            untouched.
          </p>

          {canEdit && !jobArchived && (
            <div className="job-card__foot">
              <button
                className="button is-primary"
                type="button"
                onClick={() => patch({ status: "published" })}
                disabled={busy}
              >
                Reopen applications
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
