// =============================================================================
// /unsubscribe — the one page in this product a candidate ever sees.
//
// NO SESSION, NO NAV, NO APP SHELL. The person reading this is not a user of the
// product; showing them a recruitment dashboard's chrome would be confusing at
// best. It is a single card that says what happened.
//
// THE OPT-OUT HAPPENS ON A POST, NOT ON THE GET.
//
// A mail client or a corporate link scanner fetches every URL in an email to check
// it is safe. If the GET did the work, a scanner would silently unsubscribe
// candidates who never clicked anything — and the team would have no idea why their
// messages stopped arriving. So the page renders a button, and the button submits.
// =============================================================================
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { honourUnsubscribe } from "@/lib/communications/unsubscribe";
import { isOptOutSigningConfigured } from "@/lib/communications/optout";

export const metadata = { title: "Unsubscribe" };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; state?: string }>;
}) {
  const query = await searchParams;
  const token = query.token ?? "";

  async function confirm(formData: FormData) {
    "use server";

    const submitted = String(formData.get("token") ?? "");
    const result = await honourUnsubscribe(submitted);

    // The outcome rides in the URL rather than in component state, so the
    // resulting page is a plain GET somebody can reload or bookmark without
    // re-submitting anything.
    const state = result.ok
      ? result.alreadyOptedOut
        ? `already-${result.channel}`
        : `done-${result.channel}`
      : result.reason;

    redirect(`/unsubscribe?done=1&state=${state}`);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-background)",
        padding: 24,
      }}
    >
      <div className="card" style={{ maxWidth: 480, width: "100%" }}>
        <div className="mb-4">
          <Logo />
        </div>

        {query.done ? (
          <Outcome state={query.state ?? "failed"} />
        ) : !token ? (
          <>
            <h1 className="title is-5">This link isn&apos;t complete</h1>
            <p style={{ fontSize: 14 }}>
              It looks like part of the address was cut off. Reply to the message you received and
              ask to be removed — somebody will do it by hand.
            </p>
          </>
        ) : !isOptOutSigningConfigured() ? (
          /*
            The signing key is missing, so no link this deployment produced can be
            verified. Said plainly rather than shown as a failure the candidate
            might read as their own mistake.
          */
          <>
            <h1 className="title is-5">We can&apos;t process this link</h1>
            <p style={{ fontSize: 14 }}>
              Something isn&apos;t set up correctly on our side. Reply to the message you received
              and ask to be removed — somebody will do it by hand, and it will be honoured.
            </p>
          </>
        ) : (
          <>
            <h1 className="title is-5">Stop receiving these messages?</h1>
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              We&apos;ll stop sending you automated updates about your application. A recruiter may
              still contact you directly about an application you have with us — for example, to
              answer something you asked them.
            </p>

            <form action={confirm}>
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="button is-primary">
                Yes, unsubscribe me
              </button>
            </form>

            <p className="has-text-secondary mt-4" style={{ fontSize: 12 }}>
              Nothing has changed yet. Nothing happens until you press the button.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Outcome({ state }: { state: string }) {
  if (state.startsWith("done-") || state.startsWith("already-")) {
    const channel = state.endsWith("whatsapp") ? "WhatsApp messages" : "emails";
    const already = state.startsWith("already-");

    return (
      <>
        <h1 className="title is-5" style={{ color: "var(--color-success)" }}>
          {already ? "You were already unsubscribed" : "You've been unsubscribed"}
        </h1>
        <p style={{ fontSize: 14 }}>
          You won&apos;t receive automated {channel} from us about your application. Messages we
          already sent are unaffected, and a recruiter can still reply to you directly if you
          contact them.
        </p>
      </>
    );
  }

  if (state === "invalid") {
    return (
      <>
        <h1 className="title is-5">This link isn&apos;t valid</h1>
        <p style={{ fontSize: 14 }}>
          It may have been altered, or it may be from a message that is no longer current. Reply to
          the message you received and ask to be removed — somebody will do it by hand.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="title is-5" style={{ color: "var(--color-error)" }}>
        Something went wrong
      </h1>
      <p style={{ fontSize: 14 }}>
        We couldn&apos;t record that just now, and we would rather say so than pretend. Please try
        again, or reply to the message you received and ask to be removed.
      </p>
    </>
  );
}
