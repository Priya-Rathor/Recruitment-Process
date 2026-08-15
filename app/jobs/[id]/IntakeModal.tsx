"use client";

// =============================================================================
// Bulk resume intake — the modal.
//
// Orchestration lives here rather than on the server because the unit of work
// is ONE FILE and the user needs to watch each one resolve. The client holds
// the File objects, posts them with bounded concurrency, and renders whatever
// the server says happened. It decides nothing: every status, name and link in
// this file came out of a response.
//
// CONCURRENCY IS BOUNDED AT THREE. Each file is an AI call taking 5-20 seconds,
// so serial processing of a thirty-file drop would run for ten minutes. Firing
// all thirty at once instead would open thirty sockets, spike the provider's
// rate limit, and make the first failure look like a cascade. Three is fast
// enough that a typical drop finishes while the recruiter is still reading the
// list, and slow enough that a rate limit is unlikely.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FileText,
  Loader2,
  RotateCw,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import {
  INTAKE_TONE,
  summarize,
  summaryLine,
  type IntakeStatus,
} from "@/lib/intake/status";

/** How many files are in flight at once. See the note at the top of the file. */
const CONCURRENCY = 3;

const ACCEPT = ".pdf,.docx,.txt,application/pdf,text/plain";

type Row = {
  /** Stable client id; the server row's id is not known until it resolves. */
  key: string;
  file: File;
  status: IntakeStatus;
  candidateId: string | null;
  candidateName: string | null;
  queuedConflictCount: number;
  errorMessage: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The chip's words. Kept beside the tone map so the two cannot drift apart. */
function statusLabel(row: Row): string {
  switch (row.status) {
    case "queued":
      return "Queued";
    case "processing":
      return "Parsing";
    case "candidate_created":
      return "New candidate created";
    case "candidate_matched":
      return "Application added";
    case "already_applied":
      return "Already applied to this job";
    case "match_conflict":
      return "Possible match conflict — needs manual review";
    case "failed":
      return "Couldn't parse this file";
  }
}

function StatusIcon({ status }: { status: IntakeStatus }) {
  if (status === "processing") {
    return <Loader2 size={14} aria-hidden="true" className="intake-spin" />;
  }
  if (status === "queued") return <CircleDashed size={14} aria-hidden="true" />;
  if (status === "candidate_created") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (status === "candidate_matched") return <UserCheck size={14} aria-hidden="true" />;
  if (status === "match_conflict") return <AlertTriangle size={14} aria-hidden="true" />;
  if (status === "failed") return <X size={14} aria-hidden="true" />;
  return <CheckCircle2 size={14} aria-hidden="true" />;
}

export function IntakeModal({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [batchId] = useState(() => crypto.randomUUID());

  const inputRef = useRef<HTMLInputElement>(null);
  // Rows are read inside an async loop that must not restart when they change,
  // so the loop reads this ref and React state stays the render source. Synced
  // in an effect, not during render — a ref written during render is not
  // guaranteed to survive a discarded one.
  const rowsRef = useRef<Row[]>([]);

  // Which rows a worker has taken.
  //
  // Deliberately NOT inferred from row.status. Claiming by setting the status
  // to "processing" goes through setState, which is asynchronous — two workers
  // reading the ref in the same tick would both see "queued" and both upload
  // the same file, creating a duplicate application. A synchronous Set is the
  // only thing that makes the claim atomic with respect to the loop.
  const claimed = useRef(new Set<string>());
  const running = useRef(false);

  const patch = useCallback((key: string, changes: Partial<Row>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...changes } : row))
    );
  }, []);

  /** Posts one file and writes the server's answer onto its row. */
  const send = useCallback(
    async (row: Row) => {
      patch(row.key, { status: "processing", errorMessage: null });

      const body = new FormData();
      body.append("file", row.file);
      body.append("batch_id", batchId);

      try {
        const response = await fetch(`/api/jobs/${jobId}/intake`, { method: "POST", body });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          patch(row.key, {
            status: "failed",
            errorMessage: payload?.error ?? "Couldn't process this file.",
          });
          return;
        }

        const item = payload?.data;
        patch(row.key, {
          status: (item?.status as IntakeStatus) ?? "failed",
          candidateId: item?.candidate_id ?? null,
          candidateName: item?.candidate_name ?? null,
          queuedConflictCount: item?.queued_conflict_count ?? 0,
          errorMessage: item?.error_message ?? null,
        });
      } catch {
        patch(row.key, {
          status: "failed",
          errorMessage: "Couldn't reach the server. Try this file again.",
        });
      }
    },
    [batchId, jobId, patch]
  );

  /**
   * Drains the queue with a fixed number of workers.
   *
   * The guard means a second call while a drain is running is a no-op rather
   * than a second set of workers racing the first — which is what would happen
   * if a recruiter dropped a second batch of files mid-run.
   */
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;

    try {
      const worker = async () => {
        for (;;) {
          const next = rowsRef.current.find(
            (row) => row.status === "queued" && !claimed.current.has(row.key)
          );
          if (!next) return;
          claimed.current.add(next.key);
          await send(next);
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      running.current = false;
    }
  }, [send]);

  // Publishes the latest rows to the worker loop, then kicks it if anything is
  // waiting — new files, or a retry. One effect for both, in that order, so a
  // drain started here can never read a stale list.
  useEffect(() => {
    rowsRef.current = rows;
    if (!open) return;
    const waiting = rows.some(
      (row) => row.status === "queued" && !claimed.current.has(row.key)
    );
    if (waiting) void drain();
  }, [open, rows, drain]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    setRows((current) => [
      ...current,
      ...incoming.map((file) => ({
        key: crypto.randomUUID(),
        file,
        status: "queued" as IntakeStatus,
        candidateId: null,
        candidateName: null,
        queuedConflictCount: 0,
        errorMessage: null,
      })),
    ]);
  }, []);

  const summary = summarize(rows.map((row) => row.status));
  const line = summaryLine(summary);
  const stillWorking = summary.pending > 0;
  const hasFailures = summary.failed > 0;

  function close() {
    setOpen(false);
    // The job's application list is server-rendered, so it only reflects the new
    // applications after a refresh.
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="button is-outlined-primary"
        onClick={() => setOpen(true)}
      >
        <Upload size={16} aria-hidden="true" />
        <span>Add candidates</span>
      </button>

      {open && (
        <div className="modal is-active intake-modal" role="dialog" aria-modal="true" aria-label="Add candidates">
          {/*
            The backdrop does NOT close this. A misplaced click during a
            five-minute batch would throw away the only view of what happened.
          */}
          <div className="modal-background" />

          <div className="modal-card intake-modal__card">
            <header className="intake-modal__head">
              <div>
                <h2 className="intake-modal__title">Add candidates</h2>
                <p className="intake-modal__subtitle">{jobTitle}</p>
              </div>
              <button
                type="button"
                className="intake-modal__close"
                onClick={close}
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <section className="intake-modal__body">
              <div
                className={`intake-drop${dragging ? " is-dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(event.dataTransfer.files);
                }}
              >
                <Upload size={22} strokeWidth={1.75} aria-hidden="true" className="intake-drop__icon" />
                <p className="intake-drop__headline">Drop resumes here</p>
                <p className="intake-drop__help">
                  Upload one or more resumes for this role. We&apos;ll match them to existing
                  candidates by email or phone, or create new ones.
                </p>
                <button
                  type="button"
                  className="button is-outlined-primary"
                  onClick={() => inputRef.current?.click()}
                >
                  Browse files
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  hidden
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files);
                    // Lets the same file be chosen again after a retry.
                    event.target.value = "";
                  }}
                />
                <p className="intake-drop__formats">PDF, DOCX or TXT · up to 10 MB each</p>
              </div>

              {rows.length > 0 && (
                <>
                  <p className="intake-summary" role="status">
                    {stillWorking
                      ? `Processing ${summary.pending} of ${rows.length}…${line ? ` ${line}` : ""}`
                      : line}
                  </p>

                  <ul className="intake-list">
                    {rows.map((row) => (
                      <li
                        key={row.key}
                        className={`intake-row${
                          row.status === "failed" || row.status === "match_conflict"
                            ? " is-flagged"
                            : ""
                        }`}
                      >
                        <FileText size={16} aria-hidden="true" className="intake-row__file" />

                        <div className="intake-row__meta">
                          <p className="intake-row__name" title={row.file.name}>
                            {row.file.name}
                          </p>
                          <p className="intake-row__size">{formatBytes(row.file.size)}</p>
                        </div>

                        <div className="intake-row__status">
                          <span className={`intake-chip is-${INTAKE_TONE[row.status]}`}>
                            <StatusIcon status={row.status} />
                            {statusLabel(row)}
                          </span>

                          {/* The person's name, as a link. On a match it is how
                              the recruiter checks we picked the right one; on a
                              new candidate it is how they check the parse. */}
                          {row.candidateId && row.candidateName && (
                            <Link
                              href={`/candidates/${row.candidateId}`}
                              className="intake-row__link"
                            >
                              {row.candidateName}
                            </Link>
                          )}

                          {row.queuedConflictCount > 0 && (
                            <span className="intake-row__note">
                              {row.queuedConflictCount} profile{" "}
                              {row.queuedConflictCount === 1 ? "update" : "updates"} queued for
                              review
                            </span>
                          )}

                          {row.errorMessage && (
                            <span className="intake-row__note">{row.errorMessage}</span>
                          )}
                        </div>

                        {/* Retry is offered for parse failures only. A match
                            conflict would resolve the same way every time — it
                            needs a person, not another attempt. */}
                        {row.status === "failed" && (
                          <button
                            type="button"
                            className="button is-small intake-row__retry"
                            onClick={() => {
                              // Release the claim, or the worker pool will skip
                              // the row it already processed once.
                              claimed.current.delete(row.key);
                              patch(row.key, { status: "queued", errorMessage: null });
                            }}
                          >
                            <RotateCw size={13} aria-hidden="true" />
                            Retry
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>

                  {summary.conflicts > 0 && (
                    <p className="intake-callout">
                      {summary.conflicts === 1 ? "One resume" : `${summary.conflicts} resumes`}{" "}
                      matched more than one candidate, so nothing was created for{" "}
                      {summary.conflicts === 1 ? "it" : "them"}. They stay listed on this job until
                      someone decides who they belong to.
                    </p>
                  )}
                </>
              )}
            </section>

            <footer className="intake-modal__foot">
              <p className="intake-modal__foothint">
                {stillWorking
                  ? "You can close this — processing carries on."
                  : hasFailures
                    ? "Some files need another look before you close."
                    : ""}
              </p>
              {/* Never disabled. The spec is explicit, and a modal that traps
                  someone for five minutes is worse than one they can leave. */}
              <button type="button" className="button is-primary" onClick={close}>
                Done
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
