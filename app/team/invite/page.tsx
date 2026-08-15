import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { SkeletonRows } from "@/components/states";
import { createClient } from "@/lib/supabase/server";
import {
  requireMembershipOrRedirect,
  requireCurrentUser,
  MODULE1_PERMISSIONS,
  hasRole,
} from "@/lib/tenant";
import type { OrgRole } from "@/lib/types";
import { TeamManager } from "./TeamManager";

export const metadata = { title: "Team · Recruitment OS" };

export type Member = {
  id: string;
  role: OrgRole;
  status: string;
  joined_at: string;
  user: { id: string; name: string | null; email: string; avatar_url: string | null } | null;
};

export type InviteRow = {
  id: string;
  email: string;
  role: OrgRole;
  status: string;
  expires_at: string;
  created_at: string;
};

/**
 * Loaded in a Suspense boundary so the page shell paints immediately and the
 * skeleton shows while these queries resolve (spec section 8), without a
 * client-side fetch waterfall.
 */
async function TeamData() {
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);
  const canManage = hasRole(membership.role, MODULE1_PERMISSIONS.inviteOrRemoveMembers);

  const supabase = await createClient();

  const membersQuery = supabase
    .from("organization_members")
    // The FK is named explicitly because organization_members has TWO foreign
    // keys to users — user_id and invited_by. Without it PostgREST returns
    // PGRST201 (ambiguous embedding) and refuses to guess, which surfaced as
    // "Couldn't load your team."
    .select(
      "id, role, status, joined_at, user:users!organization_members_user_id_fkey(id, name, email, avatar_url)"
    )
    .eq("organization_id", membership.organization.id)
    .eq("status", "active")
    .order("joined_at", { ascending: true });

  // Invites contain teammate email addresses — only fetched for Owner/Admin,
  // and RLS blocks it a second time regardless of what we ask for here.
  const invitesQuery = canManage
    ? supabase
        .from("invites")
        .select("id, email, role, status, expires_at, created_at")
        .eq("organization_id", membership.organization.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : null;

  const [membersResult, invitesResult] = await Promise.all([
    membersQuery,
    invitesQuery ?? Promise.resolve({ data: [], error: null }),
  ]);

  // A failing section degrades to an error message in the UI rather than
  // taking down the whole page.
  return (
    <TeamManager
      canManage={canManage}
      callerRole={membership.role}
      currentUserId={user.id}
      members={(membersResult.data as Member[] | null) ?? []}
      invites={(invitesResult.data as InviteRow[] | null) ?? []}
      membersFailed={Boolean(membersResult.error)}
      invitesFailed={Boolean(invitesResult.error)}
    />
  );
}

export default async function TeamInvitePage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <AppShell>
      <h1 className="title is-4">Team</h1>
      <p className="subtitle is-6 has-text-secondary">
        {membership.organization.name} ·{" "}
        <span style={{ textTransform: "capitalize" }}>{membership.role}</span>
      </p>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <TeamData />
      </Suspense>
    </AppShell>
  );
}
