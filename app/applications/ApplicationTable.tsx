"use client";

// =============================================================================
// The applications table.
//
// EXTRACTED FROM page.tsx, WHICH IS A SERVER COMPONENT, and only because of the
// column picker. The choice of which custom columns to show is a per-viewer
// preference held in localStorage (see components/CustomColumns.tsx), so the
// thing that reads it has to run in the browser — and the <th>/<td> it controls
// live inside the table, which therefore has to come with it.
//
// Nothing else changed in the move: the same markup, the same aging colour on
// "Last update", the same links. The rows still arrive already scoped and
// filtered by the server; this component neither fetches nor filters them.
// =============================================================================
import Link from "next/link";
import { daysSince } from "@/lib/time";
import { MatchScore, StageBadge } from "./StageBadge";
import {
  CustomColumnCell,
  CustomColumnsPicker,
  useCustomColumns,
} from "@/components/CustomColumns";
import type { CustomFieldDefinition } from "@/lib/customFields/definitions";
import type { ApplicationStage } from "@/lib/applications/stages";

export type ApplicationRow = {
  id: string;
  candidate_name: string;
  job_title: string;
  stage: ApplicationStage;
  match_score: number | null;
  recruiter_name: string | null;
  updated_at: string;
  archived_at: string | null;
};

export function ApplicationTable({
  applications,
  total,
  countSuffix,
  customFields = [],
}: {
  applications: ApplicationRow[];
  total: number;
  /** e.g. " · yours and unassigned" for a Recruiter. Decided by the page. */
  countSuffix?: string;
  customFields?: CustomFieldDefinition[];
}) {
  const columns = useCustomColumns(
    "application",
    customFields,
    applications.map((application) => application.id)
  );

  return (
    <>
      <div
        className="mb-3"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          {applications.length === total
            ? `${total} ${total === 1 ? "application" : "applications"}`
            : `Showing ${applications.length} of ${total} applications`}
          {countSuffix}
        </p>
        <CustomColumnsPicker
          definitions={customFields}
          chosenIds={columns.chosenIds}
          onToggle={columns.toggle}
        />
      </div>

      <div className="table-container">
        <table className="table is-fullwidth is-hoverable">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Job</th>
              <th>Stage</th>
              <th>Match</th>
              <th>Recruiter</th>
              <th>Last update</th>
              {columns.columns.map((definition) => (
                <th key={definition.id}>{definition.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => {
              const idleDays = daysSince(application.updated_at);
              return (
                <tr key={application.id}>
                  <td>
                    <Link href={`/applications/${application.id}`} style={{ fontWeight: 600 }}>
                      {application.candidate_name}
                    </Link>
                    {application.archived_at && (
                      <span className="tag is-light ml-2" style={{ fontSize: 11 }}>
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="has-text-secondary" style={{ fontSize: 13 }}>
                    {application.job_title}
                  </td>
                  <td>
                    <StageBadge stage={application.stage} />
                  </td>
                  <td>
                    <MatchScore score={application.match_score} />
                  </td>
                  <td className="has-text-secondary" style={{ fontSize: 13 }}>
                    {application.recruiter_name ?? "Unassigned"}
                  </td>
                  <td
                    className="has-text-secondary"
                    style={{
                      fontSize: 13,
                      color: idleDays >= 3 ? "var(--color-warning)" : undefined,
                    }}
                  >
                    {idleDays === 0 ? "Today" : `${idleDays}d ago`}
                  </td>
                  {columns.columns.map((definition) => (
                    <CustomColumnCell
                      key={definition.id}
                      definition={definition}
                      values={columns.values.get(application.id)}
                      loaded={!columns.loading}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
