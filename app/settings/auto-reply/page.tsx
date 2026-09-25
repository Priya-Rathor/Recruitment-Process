import { redirect } from "next/navigation";

// Dynamic, so this is a server redirect behind proxy.ts's auth check rather
// than a prerendered page.
export const dynamic = "force-dynamic";

/**
 * DEPRECATED ROUTE. The WhatsApp auto-reply agent's settings moved into the
 * Agent Center at /settings/agents/whatsapp. Kept as a redirect so old links
 * and bookmarks still land on the page.
 */
export default function LegacyAutoReplyRoute() {
  redirect("/settings/agents/whatsapp");
}
