import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * NEVER INDEXED. Settings is authenticated (proxy.ts redirects a signed-out
 * request to /login) and robots.ts already disallows /settings — this is the
 * third layer, for a crawler that ignores robots.txt or a page reached some
 * other way. Page titles under /settings are fixed strings ("Agents", "Edit
 * agent"): no agent name, prompt or provider detail is ever put in metadata.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
