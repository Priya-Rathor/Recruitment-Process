// Shared activity types. Separate from events.ts so the catalogue can import
// the entity vocabulary without a cycle.

export const ACTIVITY_ENTITY_TYPES = [
  "organization",
  "member",
  "job",
  "candidate",
  "application",
  "resume",
  "screening_call",
  "screening_report",
  "interview",
  "client",
  "automation",
  "integration",
  "message_template",
  /**
   * Module 21 — privacy, consent and data settings.
   *
   * A distinct entity rather than filing these under "organization", because the
   * §10 privacy log has to be separable from general settings churn: "who viewed
   * this transcript" and "who renamed the company" are both organization events
   * but only one of them belongs in a privacy report.
   */
  "privacy",
] as const;

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export function isActivityEntityType(value: unknown): value is ActivityEntityType {
  return typeof value === "string" && (ACTIVITY_ENTITY_TYPES as readonly string[]).includes(value);
}

export const ENTITY_LABELS: Record<ActivityEntityType, string> = {
  organization: "Organization",
  member: "Team member",
  job: "Job",
  candidate: "Candidate",
  application: "Application",
  resume: "Resume",
  screening_call: "Screening call",
  screening_report: "Screening report",
  interview: "Interview",
  client: "Client",
  automation: "Automation",
  integration: "Integration",
  message_template: "Message template",
  privacy: "Privacy & consent",
};

export type ActivityEvent = {
  id: string;
  organization_id: string;
  entity_type: ActivityEntityType;
  entity_id: string | null;
  event_type: string;
  actor_id: string | null;
  actor_label: string | null;
  metadata: Record<string, unknown>;
  is_sensitive: boolean;
  created_at: string;
};
