// Browser Supabase client — for use in Client Components only.
// Never import this from a Server Component/Route Handler; use ./server.ts there.
import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseConfig } from "./env";

export function createClient() {
  // Accepts both the current sb_publishable_... key and the legacy anon JWT —
  // see ./env.ts for why reading only one name fails confusingly.
  const { url, key } = requireSupabaseConfig();
  return createBrowserClient(url, key);
}
