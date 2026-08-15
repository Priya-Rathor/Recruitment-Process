// =============================================================================
// Supabase environment resolution.
//
// Supabase has two generations of API keys and both are in the wild:
//
//   legacy:  NEXT_PUBLIC_SUPABASE_ANON_KEY   (a JWT, "eyJ...")
//            SUPABASE_SERVICE_ROLE_KEY       (a JWT)
//   current: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  ("sb_publishable_...")
//            SUPABASE_SECRET_KEY                   ("sb_secret_...")
//
// A project created today issues the current pair; older projects still use the
// legacy pair. Reading only one name means a correct key in the correct file
// silently does nothing, and the failure surfaces as "Invalid API key" at login
// with nothing pointing at the cause.
//
// So both are accepted, the current name preferred. The values play the same
// role either way: the publishable/anon key is safe in a browser and is
// constrained by RLS; the secret/service-role key BYPASSES RLS and must never
// leave the server.
// =============================================================================

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * The browser-safe key. Constrained by RLS, so it is not a secret — it ships to
 * every client by design.
 */
export function supabasePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * The server-only key. BYPASSES RLS entirely, so every query made with it must
 * filter organization_id explicitly — see lib/supabase/admin.ts.
 */
export function supabaseSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Whether the browser-facing config is present AND is not the placeholder the
 * repo ships with.
 *
 * The placeholder check matters: `https://placeholder.supabase.co` is a
 * perfectly well-formed URL, so a "is it set?" check passes and the first real
 * failure is an opaque network error at sign-in. Naming it here lets the app
 * say what is actually wrong.
 */
export function isSupabaseConfigured(): boolean {
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  if (!url || !key) return false;
  if (url.includes("placeholder") || key === "placeholder") return false;

  return true;
}

/**
 * Throws with an actionable message rather than letting `undefined!` reach the
 * Supabase client, which fails much later and much less clearly.
 */
export function requireSupabaseConfig(): { url: string; key: string } {
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  if (!url || !key || url.includes("placeholder") || key === "placeholder") {
    throw new Error(
      "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the legacy " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local, then restart the dev server."
    );
  }

  return { url, key };
}
