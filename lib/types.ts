// Shared domain types for Module 1. Later modules extend this file rather
// than redefining OrgRole / Organization / Membership shapes locally.

export const ORG_ROLES = ["owner", "admin", "recruiter", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export type Organization = {
  id: string;
  name: string;
  industry: string | null;
  size: string | null;
  country: string | null;
  timezone: string;
  onboarding_answer: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
};

export type AppUser = {
  id: string;
  auth_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  created_at: string;
};

export type OrganizationMember = {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  status: "active" | "removed";
  invited_by: string | null;
  joined_at: string;
};

export type Invite = {
  id: string;
  organization_id: string;
  email: string;
  role: OrgRole;
  token: string;
  invited_by: string | null;
  expires_at: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
};

// -----------------------------------------------------------------------------
// Module 3 — Jobs
// -----------------------------------------------------------------------------

export const JOB_STATUSES = ["draft", "open", "on_hold", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

export const WORK_MODES = ["onsite", "hybrid", "remote"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === "string" && (WORK_MODES as readonly string[]).includes(value);
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

export type Job = {
  id: string;
  organization_id: string;
  /** Nullable with no FK until Module 12 (Clients) ships. */
  client_id: string | null;
  title: string;
  description: string | null;
  experience_min: number | null;
  experience_max: number | null;
  required_skills: string[];
  preferred_skills: string[];
  location: string | null;
  work_mode: WorkMode | null;
  salary_min: number | null;
  salary_max: number | null;
  status: JobStatus;
  owner_recruiter_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobQuestion = {
  id: string;
  job_id: string;
  question: string;
  display_order: number;
};

// -----------------------------------------------------------------------------
// Module 4 — Candidates
// -----------------------------------------------------------------------------

export const CANDIDATE_SOURCES = [
  "career_page",
  "resume_upload",
  "email",
  "referral",
  "job_board",
  "agency_database",
  "manual",
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export function isCandidateSource(value: unknown): value is CandidateSource {
  return typeof value === "string" && (CANDIDATE_SOURCES as readonly string[]).includes(value);
}

export const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  career_page: "Career page",
  resume_upload: "Resume upload",
  email: "Email",
  referral: "Referral",
  job_board: "Job board",
  agency_database: "Agency database",
  manual: "Manual entry",
};

export type Candidate = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  email_normalized: string | null;
  phone_normalized: string | null;
  location: string | null;
  current_company: string | null;
  current_role: string | null;
  total_experience_years: number | null;
  skills: string[];
  expected_salary: number | null;
  notice_period_days: number | null;
  /** Repeatable qualifications. See lib/candidates/profile.ts for the shape. */
  education: import("@/lib/candidates/profile").EducationEntry[];
  /** Previous employers, most recent first as entered. */
  employment_history: import("@/lib/candidates/profile").EmploymentEntry[];
  source: CandidateSource;
  resume_url: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export const DUPLICATE_STATUSES = ["open", "confirmed", "dismissed"] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

export type CandidateDuplicate = {
  id: string;
  candidate_id: string;
  duplicate_of_id: string;
  matched_on: string;
  status: DuplicateStatus;
  created_at: string;
};

// -----------------------------------------------------------------------------
// Module 5 — Applications
//
// The stage vocabulary itself lives in lib/applications/stages.ts, next to the
// transition rules that operate on it.
// -----------------------------------------------------------------------------

export type Application = {
  id: string;
  organization_id: string;
  candidate_id: string;
  job_id: string;
  stage: import("@/lib/applications/stages").ApplicationStage;
  /**
   * The stage this application was in immediately before being rejected.
   *
   * Null unless `stage` is 'rejected'. Kept because "rejected" alone destroys
   * the most useful fact about a rejection — a candidate turned down after a
   * director round and one turned down on their CV are not the same outcome.
   */
  rejected_at_stage: import("@/lib/applications/stages").ApplicationStage | null;
  match_score: number | null;
  assigned_recruiter_id: string | null;
  source: CandidateSource;
  /** Recruiter-set urgency. Not derived from stage or SLA. */
  priority: import("@/lib/applications/validation").ApplicationPriority;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Application joined with the names needed to render a row. */
export type ApplicationWithContext = Application & {
  candidate_name: string;
  job_title: string;
  recruiter_name: string | null;
};

/** A membership joined with its organization — what the org switcher renders. */
export type MembershipWithOrganization = {
  /** public.users.id of the member. Needed to scope a Recruiter to own work. */
  user_id: string;
  role: OrgRole;
  status: "active" | "removed";
  organization: Organization;
};
