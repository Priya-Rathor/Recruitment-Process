import { redirect } from "next/navigation";

/**
 * DEPRECATED ROUTE. The voice agent console moved into the Agent Center at
 * /settings/agents/voice. Kept as a redirect so bookmarks and old links land
 * on the page rather than a 404; the `?agent=` deep link is carried over.
 * Remove once nothing links here (docs/modules/24-voice-agent-console.md).
 */
export default async function LegacyVoiceConsoleRoute({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const { agent } = await searchParams;
  redirect(typeof agent === "string" ? `/settings/agents/voice?agent=${encodeURIComponent(agent)}` : "/settings/agents/voice");
}
