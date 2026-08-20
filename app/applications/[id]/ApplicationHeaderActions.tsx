"use client";

// Holds the Edit toggle and the form it reveals, so the server page stays a
// server component and only this small island ships to the browser.
import { useState, type ReactNode } from "react";
import { SquarePen } from "lucide-react";
import type { CandidateSource } from "@/lib/types";
import type { ApplicationPriority } from "@/lib/applications/validation";
import { ApplicationEditForm } from "./ApplicationEditForm";

export function ApplicationHeaderActions({
  applicationId,
  members,
  initial,
  /**
   * Module 15's "Send message", rendered beside Edit rather than in its own
   * strip — the spec asks for it "near the existing action buttons", and a second
   * row of one button below this one reads as an afterthought.
   *
   * Passed in rather than imported so this island stays about editing: the send
   * panel needs the candidate's real details, which only the server page has.
   */
  actions,
}: {
  applicationId: string;
  members: { id: string; name: string; role: string }[];
  initial: {
    assignedRecruiterId: string | null;
    source: CandidateSource;
    priority: ApplicationPriority;
  };
  actions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      // 24px (mb-5), so the run from the heading down to the Evaluation card
      // keeps one rhythm rather than alternating 16 and 24.
      <div className="mb-5 is-flex" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="button is-outlined-primary is-small"
                onClick={() => setEditing(true)}>
          <SquarePen size={14} aria-hidden="true" />
          Edit application
        </button>
        {actions}
      </div>
    );
  }

  return (
    <ApplicationEditForm
      applicationId={applicationId}
      members={members}
      initial={initial}
      onDone={() => setEditing(false)}
    />
  );
}
