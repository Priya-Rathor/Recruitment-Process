import Link from "next/link";
import { getCurrentUser } from "@/lib/tenant";
import { AcceptInvite } from "./AcceptInvite";

export const metadata = { title: "Join a workspace · Recruitment OS" };

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
                Accept as {user.email} to join the workspace.
              </p>
              {/* The token itself is the credential — validity is checked
                  server-side by the accept_invite RPC, never here. */}
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
