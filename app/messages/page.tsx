import { Suspense } from "react";
import Link from "next/link";
import { MessageCircle, Plug } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { hasRole, requireMembershipOrRedirect } from "@/lib/tenant";
import { getStatus as getWhatsAppStatus } from "@/lib/integrations/whatsapp";
import { listConversations } from "@/lib/messaging/queries";
import { Inbox } from "./Inbox";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

/**
 * /messages — the shared WhatsApp inbox.
 *
 * WHATSAPP ONLY, and the page says so rather than implying a general-purpose
 * inbox. Email has no thread model in this product: it goes out through
 * templates and is read back in the per-record communication log, and inventing
 * a chat view for it would promise a two-way conversation nothing is receiving.
 *
 * The first paint is server-rendered so the list is there immediately; the
 * client component takes over to poll for new messages, because a candidate
 * replying while somebody is reading is the whole point of an inbox.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    ?c=<id> — opened from a candidate's or an application's "View full
    conversation" link.

    A query param rather than /messages/<id>, because the pane layout is the
    page: a route per thread would make the back button walk through every
    conversation somebody clicked, and the list would remount each time.

    Not validated here beyond being a string. It is a SELECTION, not an
    authorisation — the thread is loaded by an API route that resolves the
    tenant from the session and 404s anything else, so the worst a hand-edited
    value achieves is a pane that says the conversation was not found.
  */
  const params = await searchParams;
  const raw = params.c;
  const initialConversationId = typeof raw === "string" ? raw : null;

  return (
    <AppShell>
      <PageHeader
        title="Messages"
        description="WhatsApp conversations with candidates, across every job."
      />
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={6} />
          </div>
        }
      >
        <InboxLoader initialConversationId={initialConversationId} />
      </Suspense>
    </AppShell>
  );
}

async function InboxLoader({
  initialConversationId,
}: {
  initialConversationId: string | null;
}) {
  const membership = await requireMembershipOrRedirect();

  const [whatsapp, { conversations, failed }] = await Promise.all([
    getWhatsAppStatus(membership.organization.id).catch(() => null),
    listConversations({
      organizationId: membership.organization.id,
      viewerRole: membership.role,
      viewerId: membership.user_id,
    }),
  ]);

  const connected = whatsapp?.status === "connected";

  /*
    NOT CONNECTED — say so, and say where to fix it.

    The same honest banner the Message Templates page uses, for the same reason:
    an empty inbox on a disconnected integration looks exactly like an inbox
    nobody has written to, and a recruiter would conclude no candidate ever
    replies. Rendered INSTEAD of the panes rather than above them, because there
    is nothing behind it — no thread can exist before the channel does.
  */
  if (!connected) {
    return (
      <div className="card">
        <EmptyState
          headline="WhatsApp isn't connected yet"
          message="Once it's connected, candidate replies arrive here and you can answer them without leaving the product."
          icon={MessageCircle}
          action={
            hasRole(membership.role, ["owner", "admin"]) ? (
              <Link className="button is-primary" href="/settings/integrations#integration-whatsapp">
                <Plug size={16} aria-hidden="true" />
                <span className="ml-2">Connect WhatsApp</span>
              </Link>
            ) : (
              <span className="has-text-secondary" style={{ fontSize: 13 }}>
                An Owner or Admin can connect it in Settings.
              </span>
            )
          }
        />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="card">
        <ErrorState
          headline="Couldn't load your conversations"
          message="This is not the same as having none. Reload before assuming nobody has written to you."
        />
      </div>
    );
  }

  /*
    CONNECTED BUT UNVERIFIABLE is its own state, and it is the one most likely
    to waste somebody's afternoon.

    Sending works — the access token is all that needs — while inbound events
    are rejected for want of an app secret, so the product looks healthy and the
    inbox stays permanently empty. Nothing else in the UI could tell them.
  */
  const unverifiable = whatsapp !== null && !whatsapp.webhookVerifiable;

  return (
    <Inbox
      initialConversations={conversations}
      metaTemplateConfigured={Boolean(whatsapp?.messagingTemplate)}
      canReply={hasRole(membership.role, ["owner", "admin", "recruiter"])}
      timeZone={membership.organization.timezone}
      webhookUnverifiable={unverifiable}
      canManageIntegration={hasRole(membership.role, ["owner", "admin"])}
      initialConversationId={initialConversationId}
    />
  );
}
