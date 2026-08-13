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

/** A membership joined with its organization — what the org switcher renders. */
export type MembershipWithOrganization = {
  role: OrgRole;
  status: "active" | "removed";
  organization: Organization;
};
