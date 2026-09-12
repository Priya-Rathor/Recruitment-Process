import Link from "next/link";
import { getCurrentUser } from "@/lib/tenant";
import { AcceptInvite } from "./AcceptInvite";

export const metadata = { title: "Join a workspace" };

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getCurrentUser();

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="card">
          <h1 className="title is-4">You&apos;ve been invited</h1>

          {user ? (
            <>
              <p className="subtitle is-6 has-text-secondary">
                Accept as <strong>{user.email}</strong> to join the workspace. An invite only
                works for the address it was sent to — if that isn&apos;t this one, sign out and
                sign in with the right account first.
              </p>
              {/*
                THE PAGE CANNOT PRE-CHECK THE ADDRESS, and that is deliberate
                rather than a gap. It would have to read the invite to know who
                it names, and showing that would hand a colleague's email to
                whoever is holding a forwarded link. The invites table is
                Owner/Admin-only for exactly that reason.

                So the match is proved server-side by accept_invite() (migration
                0040, reading auth.users), and the sentence above is what the
                reader gets in advance. Before 0040 that sentence was the ONLY
                thing standing between a forwarded token and an admin seat.
              */}
              <AcceptInvite token={token} />
            </>
          ) : (
            <>
              <p className="subtitle is-6 has-text-secondary">
                Sign in or create an account to accept this invite. Use the email address the invite
                was sent to.
              </p>
              <div className="buttons">
                <Link
                  className="button is-primary"
                  href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                >
                  Sign in
                </Link>
                <Link className="button" href="/signup">
                  Create account
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
