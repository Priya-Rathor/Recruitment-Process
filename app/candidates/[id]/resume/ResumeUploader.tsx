"use client";

// Upload + parse. Two explicit steps so the recruiter can see where a failure
// happened — storing the file and reading it are different problems with
// different fixes.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

export function ResumeUploader({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadAndParse(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setBusy(true);
    setError(null);
    setStatus("Uploading…");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadResponse = await fetch(`/api/candidates/${candidateId}/resumes`, {
        method: "POST",
        body: formData,
      });
      const uploaded = await uploadResponse.json().catch(() => null);

      if (!uploadResponse.ok) {
        setError(uploaded?.error ?? "Could not upload that file.");
        setStatus(null);
        return;
      }

      // The cost guard short-circuits an identical re-upload.
      if (uploaded.duplicate) {
        setStatus(null);
        setError(uploaded.message ?? "This file has already been parsed.");
        router.refresh();
        return;
      }

      setStatus("Reading the resume…");

      const parseResponse = await fetch(`/api/resumes/${uploaded.data.id}/parse`, {
        method: "POST",
      });
      const parsed = await parseResponse.json().catch(() => null);

      if (!parseResponse.ok) {
        // The file IS stored — only parsing failed, so say so and leave the
        // manual route open rather than implying the upload was lost.
        setError(
          `${parsed?.error ?? "Could not read that resume."} The file has been saved; you can enter the details manually.`
        );
        setStatus(null);
        router.refresh();
        return;
      }

      setStatus(null);
      setFile(null);
      // Straight to review: parsed data is a proposal and needs a decision.
      router.push(`/candidates/${candidateId}/resume/review`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={uploadAndParse}>
      <FormError message={error} />

      <div className="field">
        <label className="label" htmlFor="resume-file">
          Resume file
        </label>
        <input
          id="resume-file"
          className="input"
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
        <p className="help has-text-secondary">
          PDF, DOCX, or plain text, up to 10 MB. Scanned images can&apos;t be read — OCR isn&apos;t
          supported yet.
        </p>
      </div>

      {status && (
        <p className="mb-3" style={{ fontSize: 14, color: "var(--color-info)" }}>
          {status}
        </p>
      )}

      <button
        type="submit"
        className={`button is-primary ${busy ? "is-loading" : ""}`}
        disabled={busy || !file}
      >
        Upload and read
      </button>
    </form>
  );
}

/** Re-parse an already-uploaded resume, e.g. after an AI outage. */
export function ReparseButton({
  resumeId,
  candidateId,
}: {
  resumeId: string;
  candidateId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reparse() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/resumes/${resumeId}/parse`, { method: "POST" });
    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not read that resume.");
      router.refresh();
      return;
    }

    router.push(`/candidates/${candidateId}/resume/review`);
    router.refresh();
  }

  return (
    <div>
      <FormError message={error} />
      <button
        type="button"
        className={`button is-small ${busy ? "is-loading" : ""}`}
        onClick={reparse}
        disabled={busy}
      >
        Read again
      </button>
    </div>
  );
}
