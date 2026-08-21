// =============================================================================
// /coding/{token} — the one page a candidate ever writes on.
//
// NO SESSION, NO NAV, NO APP SHELL. The person reading this is not a user of the
// product; wrapping their editor in a recruitment dashboard's chrome would be
// confusing at best, and at worst would offer them links they cannot open. The
// same call /unsubscribe already made, for the same reason.
//
// The token is verified SERVER-SIDE before anything renders, so an invalid or
// finished session never ships an editor to the browser at all.
// =============================================================================
import { AlertCircle, Ban, Clock } from "lucide-react";
import type { ComponentType } from "react";
import { Logo } from "@/components/Logo";
import { loadCandidateSession } from "@/lib/coding/candidate";
import { CodingWorkspace } from "./CodingWorkspace";

export const metadata = { title: "Coding round" };
/**
 * Never cached. The session's status changes underneath this page — an
 * interviewer can cancel the round mid-interview — and a cached render would
 * hand somebody an editor for a session that had already closed.
 */
export const dynamic = "force-dynamic";

export default async function CodingSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // `touch` marks the first open and moves the session to in_progress, so the
  // interviewer's monitor can say "they have the link" before any code arrives.
  const result = await loadCandidateSession(token, { touch: true });

  if (!result.ok) {
    return <ClosedCard code={result.code} message={result.message} />;
  }

  return (
    <main className="coding-page">
      <div className="coding-page__brand">
        <Logo variant="compact" height={26} priority />
      </div>
      <CodingWorkspace token={token} session={result.view} />
    </main>
  );
}

const REFUSAL_ICONS: Record<string, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  expired: Clock,
  cancelled: Ban,
  invalid: AlertCircle,
  unavailable: AlertCircle,
};

const REFUSAL_HEADLINES: Record<string, string> = {
  expired: "This coding session has expired",
  cancelled: "This coding round was cancelled",
  invalid: "Invalid coding session",
  unavailable: "This coding round isn't available",
};

/**
 * The refusal states, rendered as one card.
 *
 * EVERY ONE NAMES WHAT TO DO NEXT. The reader has no account, no support link
 * and no way to ask this product anything — so the only useful action is "tell
 * your interviewer", and each message says so in the words that fit its case.
 */
function ClosedCard({ code, message }: { code: string; message: string }) {
  const Icon = REFUSAL_ICONS[code] ?? AlertCircle;
  const headline = REFUSAL_HEADLINES[code] ?? "This coding round isn't available";

  return (
    <main className="auth-layout">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo variant="full" height={48} priority />
        </div>

        <div className="card">
          <p className="coding-closed__icon" aria-hidden="true">
            <Icon size={28} />
          </p>
          <h1 className="title is-5 mb-2">{headline}</h1>
          <p className="has-text-secondary" style={{ fontSize: 14 }}>
            {message}
          </p>
        </div>
      </div>
    </main>
  );
}
