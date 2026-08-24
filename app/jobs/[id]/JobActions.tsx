"use client";

// Archive action. Owner/Admin only — the API enforces the same rule
// independently, and RLS has no DELETE policy at all because jobs are archived
// rather than destroyed (Applications and Analytics reference them).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

export function ArchiveJobButton({ jobId, title }: { jobId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not archive this job.");
      return;
    }

    router.push("/jobs");
    router.refresh();
  }

  if (!confirming) {
    return (
      <div>
        <FormError message={error} />
        {/* Danger-light, matching the red border and heading of the section it
            sits in. It was inheriting Bulma's default button, which this theme
            paints near-black — the one control on the page whose colour carried
            no meaning at all. */}
        <button
          type="button"
          className="button is-small is-danger-soft"
          onClick={() => setConfirming(true)}
        >
          Archive job
        </button>
      </div>
    );
  }

  return (
    <div>
      <FormError message={error} />
      {/* Explicit confirmation: archiving closes the job and hides it from the
          default list, so it is not a one-click action. */}
      <p className="mb-2" style={{ fontSize: 13 }}>
        Archive <strong>{title}</strong>? It will be closed and hidden from the jobs list. Nothing is
        deleted.
      </p>
      <div className="buttons">
        <button
          type="button"
          className={`button is-small is-danger-solid ${busy ? "is-loading" : ""}`}
          onClick={archive}
          disabled={busy}
        >
          Yes, archive
        </button>
        <button
          type="button"
          className="button is-small is-quiet"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
