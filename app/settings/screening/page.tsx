import { redirect } from "next/navigation";

// Dynamic, so this is a server redirect behind proxy.ts's auth check.
export const dynamic = "force-dynamic";

/**
 * DEPRECATED ROUTE. "Screening" (later "Screening defaults") configured how the
 * voice screening call behaves — attempts, retry delay, language, recording —
 * which is agent behaviour. Those call rules now live on the voice screening
 * agent's page in the Agent Center. Kept as a redirect for old links.
 */
export default function LegacyScreeningSettingsRoute() {
  redirect("/settings/agents/voice#call-rules");
}
