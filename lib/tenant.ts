// =============================================================================
// Tenant + role resolution — Module 1's contract with every later module.
//
// RULE (from the spec, non-negotiable): every authenticated request resolves
// organization_id from the SESSION, never from client input. The active-org
// cookie below is a *hint* only; it is always validated against a real
// organization_members row before being trusted. A user who tampers with the
// cookie gets their default org back, not access to someone else's tenant.
//
// Every later module's API routes must call requireMembership()/requireRole()
// instead of accepting an organization_id parameter from the browser.
// =============================================================================
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppUser, MembershipWithOrganization, OrgRole } from "@/lib/types";

export const ACTIVE_ORG_COOKIE = "active_organization_id";

/** Thrown for auth/permission failures; carries the HTTP status to return. */
export class TenantError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404
  ) {
    super(message);
    this.name = "TenantError";
  }
}

/** The authenticated user's public.users row, or null if not signed in. */
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("auth_id", user.id)
    .maybeSingle();

  return (data as AppUser) ?? null;
}

export async function requireCurrentUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new TenantError("Not authenticated", 401);
  return user;
}

/**
 * Every active membership for the signed-in user, oldest first.
 * Drives the org switcher and the "which org do I default to?" decision.
 */
export async function getUserMemberships(): Promise<MembershipWithOrganization[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  // MUST filter by user_id. RLS on organization_members intentionally exposes
  // every member row of an org the caller belongs to (the team list needs
  // that), so an unfiltered query would return teammates' rows — and picking
  // memberships[0] from that would hand the caller someone else's role.
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, status, organization:organizations(*)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("joined_at", { ascending: true });

  if (error || !data) return [];

  // Defensive: an org row can be null if the join is filtered out by RLS.
  return (data as unknown as MembershipWithOrganization[]).filter((m) => m.organization);
}

/**
 * The caller's membership in the currently active organization.
 * Returns null when the user is signed in but belongs to no organization yet
 * (i.e. mid-onboarding) — callers decide whether that's an error or a redirect.
 */
export async function getCurrentMembership(): Promise<MembershipWithOrganization | null> {
  const memberships = await getUserMemberships();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  // The cookie is validated against real memberships — a forged value simply
  // falls through to the default rather than granting any access.
  const active = requested
    ? memberships.find((m) => m.organization.id === requested)
    : undefined;

  return active ?? memberships[0];
}

/**
 * For API ROUTES. Throws TenantError, which handleRouteError() turns into a
 * JSON 401/403 — never an HTML redirect.
 */
export async function requireMembership(): Promise<MembershipWithOrganization> {
  await requireCurrentUser();
  const membership = await getCurrentMembership();
  if (!membership) throw new TenantError("No organization membership", 403);
  return membership;
}

/**
 * For PAGES. Same resolution as requireMembership(), but sends the user
 * somewhere useful instead of throwing: /login if there's no session,
 * /onboarding if they're signed in but haven't created or joined an
 * organization yet. Every module's authenticated pages should use this.
 */
export async function requireMembershipOrRedirect(): Promise<MembershipWithOrganization> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const membership = await getCurrentMembership();
  if (!membership) redirect("/onboarding");

  return membership;
}

/**
 * The server-resolved tenant id. This is the function every later module's
 * API routes must call — never read organization_id from a request body,
 * query string, or header.
 */
export async function getCurrentOrganizationId(): Promise<string> {
  const membership = await requireMembership();
  return membership.organization.id;
}

/**
 * Role gate, enforced in the API layer independently of the UI (RLS enforces
 * it a second time at the database). Throws 403 on failure.
 */
export async function requireRole(
  allowed: readonly OrgRole[]
): Promise<MembershipWithOrganization> {
  const membership = await requireMembership();
  if (!allowed.includes(membership.role)) {
    throw new TenantError(
      `Requires role: ${allowed.join(" or ")}. You are ${membership.role}.`,
      403
    );
  }
  return membership;
}

export function hasRole(role: OrgRole, allowed: readonly OrgRole[]): boolean {
  return allowed.includes(role);
}

/** Permission matrix for Module 1, per the spec's section 9. Single source of
 *  truth for both the UI (hide/disable) and the API (reject). */
export const MODULE1_PERMISSIONS = {
  inviteOrRemoveMembers: ["owner", "admin"],
  changeRoles: ["owner", "admin"],
  acceptOnboardingAiSuggestions: ["owner", "admin"],
} as const satisfies Record<string, readonly OrgRole[]>;
