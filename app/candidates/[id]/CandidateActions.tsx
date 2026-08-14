"use client";

// Archive action. Owner/Admin only; the API enforces the same rule, and there
// is no DELETE policy in RLS at all — candidates are archived, never destroyed,
// because Applications and Analytics reference them.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

export function ArchiveCandidateButton({
  candidateId,
  name,
}: {
  candidateId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/candidates/${candidateId}`, { method: "DELETE" });
    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not archive this candidate.");
      return;
    }

    router.push("/candidates");
    router.refresh();
  }

  if (!confirming) {
    return (
      <div>
        <FormError message={error} />
        <button
          type="button"
          className="button is-small"
          style={{ color: "var(--color-error)" }}
          onClick={() => setConfirming(true)}
        >
          Archive candidate
        </button>
        <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
          Archiving hides the candidate from lists. It does not erase their personal data — that is
          a separate, audited action arriving with the privacy work.
        </p>
      </div>
    );
  }

  return (
    <div>
      <FormError message={error} />
      <p className="mb-2" style={{ fontSize: 13 }}>
        Archive <strong>{name}</strong>? They will be hidden from the candidate list. Nothing is
        deleted.
      </p>
      <div className="buttons">
        <button
          type="button"
          className={`button is-small ${busy ? "is-loading" : ""}`}
          style={{ background: "var(--color-error)", color: "#fff" }}
          onClick={archive}
          disabled={busy}
        >
          Yes, archive
        </button>
        <button
          type="button"
          className="button is-small"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
