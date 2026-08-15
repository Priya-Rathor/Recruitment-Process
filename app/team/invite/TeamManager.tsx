"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, ErrorState, FormError } from "@/components/states";
import { formatDateInZone } from "@/lib/time";
import { ORG_ROLES, type OrgRole } from "@/lib/types";
import type { InviteRow, Member } from "./page";
import { Mail, Users } from "lucide-react";

export function TeamManager({
  canManage,
  callerRole,
  currentUserId,
  timeZone,
  members,
  invites,
  membersFailed,
  invitesFailed,
}: {
  canManage: boolean;
  callerRole: OrgRole;
  currentUserId: string;
  /** The ORGANIZATION's timezone, so dates read the same on server and client. */
  timeZone: string;
  members: Member[];
  invites: InviteRow[];
  membersFailed: boolean;
  invitesFailed: boolean;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("recruiter");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  /** Re-runs the server component's queries so the lists reflect the change. */
  function refresh() {
    startTransition(() => router.refresh());
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    setInviteBusy(true);
    setInviteError(null);
    setInviteUrl(null);

    const response = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });

    const payload = await response.json().catch(() => null);
    setInviteBusy(false);

    if (!response.ok) {
      setInviteError(payload?.error ?? "Could not create the invite.");
      return;
    }

    // Module 15 (Notifications) will email this link. Until then the
    // Owner/Admin shares it manually — shown once, here.
    setInviteUrl(payload.invite_url as string);
    setEmail("");
    refresh();
  }

  /** Shared handler for the row-level mutations — all follow the same shape. */
  async function mutateRow(
    id: string,
    request: () => Promise<Response>,
    fallbackMessage: string
  ) {
    setRowBusyId(id);
    setRowError(null);

    const response = await request();
    setRowBusyId(null);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setRowError(payload?.error ?? fallbackMessage);
      return;
    }
    refresh();
  }

  const revokeInvite = (id: string) =>
    mutateRow(id, () => fetch(`/api/invites/${id}`, { method: "DELETE" }), "Could not revoke that invite.");

  const changeRole = (memberId: string, nextRole: OrgRole) =>
    mutateRow(
      memberId,
      () =>
        fetch(`/api/members/${memberId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        }),
      "Could not change that role."
    );

  const removeMember = (memberId: string) =>
    mutateRow(
      memberId,
      () => fetch(`/api/members/${memberId}`, { method: "DELETE" }),
      "Could not remove that member."
    );

  /** Only an Owner may grant/revoke Owner — mirrors the API's guard. */
  const assignableRoles = ORG_ROLES.filter((r) => r !== "owner" || callerRole === "owner");
  const rowsLocked = rowBusyId !== null || isRefreshing;

  return (
    <div>
      {canManage && (
        <div className="card mb-5">
          <h2 className="title is-5">Invite a teammate</h2>
          <FormError message={inviteError} />

          <form onSubmit={sendInvite}>
            <div className="field is-grouped">
              <div className="control is-expanded">
                <label className="label" htmlFor="invite-email">
                  Email
                </label>
                <input
                  id="invite-email"
                  className="input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="control">
                <label className="label" htmlFor="invite-role">
                  Role
                </label>
                <div className="select">
                  <select
                    id="invite-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as OrgRole)}
                  >
                    {assignableRoles.map((r) => (
                      <option key={r} value={r} style={{ textTransform: "capitalize" }}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className={`button is-primary ${inviteBusy ? "is-loading" : ""}`}
              disabled={inviteBusy}
            >
              Create invite
            </button>
          </form>

          {inviteUrl && (
            <div className="ai-panel mt-4">
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Share this invite link
              </p>
              <p className="has-text-secondary mb-2" style={{ fontSize: 12 }}>
                Shown once. Email delivery arrives with the Notifications module.
              </p>
              <code style={{ fontSize: 12, wordBreak: "break-all" }}>{inviteUrl}</code>
            </div>
          )}
        </div>
      )}

      {canManage && (
        <div className="card mb-5">
          <h2 className="title is-5">Pending invites</h2>
          {invitesFailed ? (
            <ErrorState message="Couldn't load pending invites." onRetry={refresh} />
          ) : invites.length === 0 ? (
            <EmptyState headline="No pending invites"
            message="Invites you send appear here until they're accepted."
            icon={Mail} />
          ) : (
            <div className="table-container">
              <table className="table is-fullwidth">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Expires</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => (
                    <tr key={invite.id}>
                      <td>{invite.email}</td>
                      <td style={{ textTransform: "capitalize" }}>{invite.role}</td>
                      <td className="has-text-secondary">
                        {/* Explicit locale AND timezone: toLocaleDateString()
                            with no arguments uses each runtime's own defaults,
                            so the server rendered "8/22/2026" and the browser
                            "22/08/2026" — a hydration mismatch. */}
                        {formatDateInZone(invite.expires_at, timeZone)}
                      </td>
                      <td className="has-text-right">
                        <button
                          type="button"
                          className={`button is-small ${
                            rowBusyId === invite.id ? "is-loading" : ""
                          }`}
                          style={{ color: "var(--color-error)" }}
                          onClick={() => revokeInvite(invite.id)}
                          disabled={rowsLocked}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="title is-5">Members</h2>
        <FormError message={rowError} />

        {membersFailed ? (
          <ErrorState message="Couldn't load your team." onRetry={refresh} />
        ) : members.length === 0 ? (
          <EmptyState headline="No teammates yet"
            message="Invite someone above to start sharing the work."
            icon={Users} />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.user?.id === currentUserId;
                  // An Admin cannot touch an Owner's row — same rule the API enforces.
                  const canEditRow =
                    canManage && (callerRole === "owner" || member.role !== "owner");

                  return (
                    <tr key={member.id}>
                      <td>
                        {member.user?.name ?? "—"}
                        {isSelf && (
                          <span className="tag is-light ml-2" style={{ fontSize: 11 }}>
                            You
                          </span>
                        )}
                      </td>
                      <td className="has-text-secondary">{member.user?.email ?? "—"}</td>
                      <td>
                        {canEditRow ? (
                          <div className="select is-small">
                            <select
                              value={member.role}
                              onChange={(e) => changeRole(member.id, e.target.value as OrgRole)}
                              disabled={rowsLocked}
                              aria-label={`Role for ${member.user?.email ?? "member"}`}
                            >
                              {assignableRoles.map((r) => (
                                <option key={r} value={r} style={{ textTransform: "capitalize" }}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <span style={{ textTransform: "capitalize" }}>{member.role}</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="has-text-right">
                          {canEditRow && !isSelf && (
                            <button
                              type="button"
                              className={`button is-small ${
                                rowBusyId === member.id ? "is-loading" : ""
                              }`}
                              style={{ color: "var(--color-error)" }}
                              onClick={() => removeMember(member.id)}
                              disabled={rowsLocked}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!canManage && (
          <p className="has-text-secondary mt-3" style={{ fontSize: 13 }}>
            Only an Owner or Admin can invite teammates or change roles.
          </p>
        )}
      </div>
    </div>
  );
}
