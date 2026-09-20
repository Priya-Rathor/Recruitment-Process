import { Suspense } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SkeletonRows } from "@/components/states";
import { getAutoReplySettings } from "@/lib/autoReply/queries";
import { getStatus as getWhatsAppStatus } from "@/lib/integrations/whatsapp";
import { isAiConfigured } from "@/lib/ai/provider";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { AutoReplySettings } from "./AutoReplySettings";

export const metadata = { title: "Message auto-reply agent" };
export const dynamic = "force-dynamic";

export default async function AutoReplySettingsPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <SettingsShell
      title="Message auto-reply agent"
      description="An AI that reads a candidate's real application data before answering their WhatsApp message."
    >
      {/*
        OWNER/ADMIN ONLY, and unlike the Message Templates page this one really
        is restricted rather than read-only-for-everyone.

        The difference is what the page DOES: templates are wording a recruiter
        should be able to read before a candidate receives it, while this page
        decides whether an unattended AI messages people at all. Every control on
        it is a control only an Owner or Admin may touch, so a read-only version
        would be a page with nothing on it but an explanation of why.
      */}
      {hasRole(membership.role, ["owner", "admin"]) ? (
        <Suspense
          fallback={
            <div className="card">
              <SkeletonRows rows={6} />
            </div>
          }
        >
          <Loader organizationId={membership.organization.id} />
        </Suspense>
      ) : (
        <RestrictedPanel what="the auto-reply agent" />
      )}
    </SettingsShell>
  );
}

async function Loader({ organizationId }: { organizationId: string }) {
  const [settings, whatsapp] = await Promise.all([
    getAutoReplySettings(organizationId),
    getStatus(organizationId),
  ]);

  if (settings.failed) {
    return (
      <div className="card" style={{ borderColor: "var(--color-error)" }}>
        <h2 className="title is-5" style={{ color: "var(--color-error)" }}>
          Couldn&apos;t load the agent&apos;s settings
        </h2>
        <p className="has-text-secondary" style={{ fontSize: 14 }}>
          Nothing has been changed. Reload before assuming the agent is switched off — treat its
          state as unknown rather than as inactive.
        </p>
      </div>
    );
  }

  return (
    <>
      {/*
        THE TWO DEPENDENCIES, STATED BEFORE THE FORM.

        Both fail silently in a way that looks like the agent working: without
        WhatsApp nothing can be received or sent at all, and without an AI
        provider the agent skips every message and leaves it in the inbox. An
        admin configuring tone instructions against either of those would be
        tuning something that never runs.
      */}
      {(!whatsapp.connected || !whatsapp.aiConfigured) && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14, margin: 0 }}>
            <strong>The agent can&apos;t run yet.</strong>{" "}
            {!whatsapp.connected && (
              <>
                WhatsApp isn&apos;t connected, so there are no messages to answer.{" "}
                <Link className="text-link" href="/settings/integrations#integration-whatsapp">
                  <Plug size={14} aria-hidden="true" /> Connect WhatsApp
                </Link>
                .{" "}
              </>
            )}
            {!whatsapp.aiConfigured && (
              <>
                No AI provider is configured on this server, so the agent skips every message and
                leaves it in the inbox for a person. Nothing is lost — but nothing is answered
                either.
              </>
            )}
          </p>
        </div>
      )}

      <AutoReplySettings
        initial={settings}
        whatsappConnected={whatsapp.connected}
        aiConfigured={whatsapp.aiConfigured}
      />
    </>
  );
}

/**
 * The two prerequisites, read independently so one failing cannot hide the
 * other — the same rule lib/communications/channels.ts follows.
 */
async function getStatus(organizationId: string) {
  const whatsapp = await getWhatsAppStatus(organizationId).catch(() => null);

  return {
    connected: whatsapp?.status === "connected",
    // Server-side, so the page states a fact about this deployment rather than
    // guessing. isAiConfigured() reads an env var and never leaves the server.
    aiConfigured: isAiConfigured(),
  };
}
