"use client";

// =============================================================================
// The per-hire document checklist.
//
// Every row's actions come from documentActions() in lib/onboarding/documents.ts
// — the same function the tests exercise — so what is rendered and what the API
// accepts cannot drift. In particular, VERIFY AND REJECT ARE NOT RENDERED FOR A
// RECRUITER, the route refuses them anyway, and the RLS policy refuses them a
// third time for a client that skips the route entirely.
//
// UPLOAD IS THE SAME CONTROL FOR EVERY ROW, including the ones tagged Candidate.
// There is no candidate portal in this product (see the module notes), so the
// recruiter files what arrived by email or WhatsApp. The tag stays because whose
// document it is does not change based on who did the filing.
// =============================================================================

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  FileUp,
  Paperclip,
  Plus,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/states";
import {
  DOCUMENT_OWNER_LABELS,
  DOCUMENT_OWNERS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_TONE,
  documentActions,
  groupedForDisplay,
  type DocumentOwner,
} from "@/lib/onboarding/documents";
import type { OnboardingDocument } from "@/lib/onboarding/queries";

export function DocumentChecklist({
  recordId,
  documents,
  canManage,
  canVerify,
  locked,
  timeZone,
}: {
  recordId: string;
  documents: OnboardingDocument[];
  canManage: boolean;
  canVerify: boolean;
  /** True once onboarding is marked complete — nothing is editable. */
  locked: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);

  const { required, optional } = groupedForDisplay(documents);

  async function act(documentId: string, body: Record<string, unknown>) {
    setBusyId(documentId);
    setError(null);

    const response = await fetch(`/api/onboarding/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not save that change.");
      return false;
    }

    router.refresh();
    return true;
  }

  async function upload(documentId: string, file: File) {
    setBusyId(documentId);
    setError(null);

    const form = new FormData();
    form.append("file", file);

    const response = await fetch(`/api/onboarding/documents/${documentId}/file`, {
      method: "POST",
      body: form,
    });

    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not upload that file.");
      return;
    }
    router.refresh();
  }

  async function removeOneOff(documentId: string) {
    setBusyId(documentId);
    setError(null);

    const response = await fetch(`/api/onboarding/documents/${documentId}`, { method: "DELETE" });
    setBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not remove that document.");
      return;
    }
    router.refresh();
  }

  function renderGroup(group: OnboardingDocument[], heading: string, note: string) {
    if (group.length === 0) return null;

    return (
      <section className="doc-group">
        <div className="doc-group__head">
          <h3 className="doc-group__title">{heading}</h3>
          <p className="doc-group__note">{note}</p>
        </div>

        <ul>
          {group.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              busy={busyId === document.id}
              locked={locked}
              canManage={canManage}
              canVerify={canVerify}
              timeZone={timeZone}
              rejecting={rejecting === document.id}
              reason={reason}
              onReasonChange={setReason}
              onStartReject={() => {
                setRejecting(document.id);
                setReason("");
                setError(null);
              }}
              onCancelReject={() => setRejecting(null)}
              onConfirmReject={async () => {
                const ok = await act(document.id, {
                  status: "rejected",
                  rejection_reason: reason,
                });
                if (ok) setRejecting(null);
              }}
              onVerify={() => act(document.id, { status: "verified" })}
              onReset={() => act(document.id, { status: "pending" })}
              onUpload={(file) => upload(document.id, file)}
              onRemove={() => removeOneOff(document.id)}
            />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <>
      <FormError message={error} />

      {documents.length === 0 ? (
        <div className="card">
          <h2 className="title is-5">No checklist for this hire</h2>
          <p className="has-text-secondary" style={{ fontSize: 14 }}>
            This onboarding was created when your organization had no active document types, so
            nothing was generated. Adding document types in Settings affects new hires only — use
            &ldquo;Add document&rdquo; below to build this one&apos;s checklist by hand.
          </p>
        </div>
      ) : (
        <div className="card">
          {renderGroup(
            required,
            "Required",
            "All of these must be verified before onboarding can be completed."
          )}
          {renderGroup(
            optional,
            "Optional",
            "Collected when available. These never block completion."
          )}
        </div>
      )}

      {canManage && !locked && (
        <div className="mt-4">
          {adding ? (
            <AddDocumentForm
              recordId={recordId}
              onDone={() => {
                setAdding(false);
                router.refresh();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              className="button is-outlined-primary is-small"
              onClick={() => setAdding(true)}
            >
              <Plus size={14} aria-hidden="true" />
              Add document
            </button>
          )}
        </div>
      )}
    </>
  );
}

function DocumentRow({
  document,
  busy,
  locked,
  canManage,
  canVerify,
  timeZone,
  rejecting,
  reason,
  onReasonChange,
  onStartReject,
  onCancelReject,
  onConfirmReject,
  onVerify,
  onReset,
  onUpload,
  onRemove,
}: {
  document: OnboardingDocument;
  busy: boolean;
  locked: boolean;
  canManage: boolean;
  canVerify: boolean;
  timeZone: string;
  rejecting: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onConfirmReject: () => void;
  onVerify: () => void;
  onReset: () => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Locked collapses every capability at once, so a completed onboarding cannot
  // be edited through a control that was rendered before it was completed.
  const actions = locked
    ? { canUpload: false, canVerify: false, canReject: false, canView: document.status !== "pending" }
    : documentActions({ status: document.status, canManage, canVerify });

  const OwnerIcon = document.expected_from === "candidate" ? UserRound : Users;

  return (
    <li className="doc-row" id={`document-${document.id}`}>
      <div className="doc-row__main">
        <div className="doc-row__heading">
          <p className="doc-row__name">{document.name}</p>

          {/* Whose responsibility this is, conceptually — see the file header. */}
          <span className={`doc-row__owner is-${document.expected_from}`}>
            <OwnerIcon size={12} aria-hidden="true" />
            {DOCUMENT_OWNER_LABELS[document.expected_from]}
          </span>

          <StatusChip
            tone={DOCUMENT_STATUS_TONE[document.status]}
            label={DOCUMENT_STATUS_LABELS[document.status]}
          />

          {document.template_id === null && (
            <span className="doc-row__oneoff" title="Added for this hire only">
              One-off
            </span>
          )}
        </div>

        {document.status === "verified" && document.verified_at && (
          <p className="doc-row__meta is-verified">
            <Check size={12} aria-hidden="true" />
            Verified by {document.verified_by_name ?? "a reviewer"} on{" "}
            {formatDate(document.verified_at, timeZone)}
          </p>
        )}

        {document.status === "rejected" && (
          <p className="doc-row__meta is-rejected">
            <AlertTriangle size={12} aria-hidden="true" />
            Rejected: {document.rejection_reason}
          </p>
        )}

        {document.status === "uploaded" && document.uploaded_at && (
          <p className="doc-row__meta">
            Uploaded by {document.uploaded_by_name ?? "a colleague"} on{" "}
            {formatDate(document.uploaded_at, timeZone)}
          </p>
        )}

        {document.notes && <p className="doc-row__meta">{document.notes}</p>}

        {rejecting && (
          <div className="doc-row__reject">
            <label className="label" style={{ fontSize: 12 }} htmlFor={`reason-${document.id}`}>
              Why is it being rejected?
            </label>
            {/* Not optional. Whoever uploaded it sees this, and "rejected" with
                no reason means they have to guess what to send instead. */}
            <textarea
              id={`reason-${document.id}`}
              className="textarea is-small"
              rows={2}
              maxLength={500}
              placeholder="e.g. The scan is cut off — the number isn't readable."
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
            />
            <div className="is-flex mt-2" style={{ gap: "var(--space-2)" }}>
              <button
                type="button"
                className={`button is-small doc-row__confirm-reject ${busy ? "is-loading" : ""}`}
                disabled={busy || reason.trim().length === 0}
                onClick={onConfirmReject}
              >
                Reject document
              </button>
              <button type="button" className="button is-small" onClick={onCancelReject}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="doc-row__actions">
        {actions.canView && (
          <a
            className="button is-small"
            href={`/api/onboarding/documents/${document.id}/file`}
            target="_blank"
            rel="noreferrer"
          >
            <Paperclip size={13} aria-hidden="true" />
            View file
          </a>
        )}

        {actions.canVerify && (
          <button
            type="button"
            className={`button is-small doc-row__verify ${busy ? "is-loading" : ""}`}
            disabled={busy}
            onClick={onVerify}
          >
            <Check size={13} aria-hidden="true" />
            Verify
          </button>
        )}

        {actions.canReject && !rejecting && (
          <button type="button" className="button is-small" disabled={busy} onClick={onStartReject}>
            <X size={13} aria-hidden="true" />
            Reject
          </button>
        )}

        {actions.canUpload && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="is-sr-only"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                // Cleared so choosing the same file twice fires again.
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className={`button is-small doc-row__upload${dragOver ? " is-dragover" : ""} ${
                busy ? "is-loading" : ""
              }`}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const file = event.dataTransfer.files?.[0];
                if (file) onUpload(file);
              }}
            >
              <FileUp size={13} aria-hidden="true" />
              {document.status === "pending" ? "Upload" : "Replace"}
            </button>
          </>
        )}

        {/* Un-verifying, or clearing a rejection. Owner/Admin only — undoing a
            review is itself a review decision, and it shows in the audit log. */}
        {canVerify && !locked && document.status !== "pending" && (
          <button type="button" className="button is-small" disabled={busy} onClick={onReset}>
            Reset
          </button>
        )}

        {canVerify && !locked && document.template_id === null && (
          <button
            type="button"
            className="button is-small doc-row__remove"
            aria-label={`Remove ${document.name}`}
            disabled={busy}
            onClick={onRemove}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

function AddDocumentForm({
  recordId,
  onDone,
  onCancel,
}: {
  recordId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<DocumentOwner>("candidate");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/onboarding/${recordId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, expected_from: owner, required }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not add that document.");
      return;
    }
    onDone();
  }

  return (
    <div className="card">
      <h3 className="title is-6 mb-1">Add a document for this hire</h3>
      <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
        For something specific to this person — a visa copy, a professional licence. It is not added
        to your organization&apos;s checklist, so other hires are unaffected.
      </p>

      <FormError message={error} />

      <div className="field">
        <label className="label" htmlFor="oneoff-name">Document name</label>
        <input
          id="oneoff-name"
          className="input"
          type="text"
          maxLength={120}
          placeholder="e.g. Work permit"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="is-flex mb-3" style={{ gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div className="field mb-0">
          <label className="label" htmlFor="oneoff-owner">Provided by</label>
          <div className="select">
            <select
              id="oneoff-owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value as DocumentOwner)}
            >
              {DOCUMENT_OWNERS.map((value) => (
                <option key={value} value={value}>
                  {DOCUMENT_OWNER_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field mb-0">
          <span className="label">Requirement</span>
          <label className="doc-template__required" style={{ height: 40 }}>
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />
            Blocks completion until verified
          </label>
        </div>
      </div>

      <div className="is-flex" style={{ gap: "var(--space-2)" }}>
        <button
          type="button"
          className={`button is-primary is-small ${busy ? "is-loading" : ""}`}
          disabled={busy || name.trim().length === 0}
          onClick={submit}
        >
          Add document
        </button>
        <button type="button" className="button is-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatDate(iso: string, timeZone: string): string {
  // The ORGANIZATION's timezone, per lib/time.ts's rule — never the browser's,
  // which would show a Mumbai team a verification date recorded in London.
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
}
