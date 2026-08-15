// =============================================================================
// Service-role Supabase client — SERVER ONLY, and narrowly scoped.
//
// This client BYPASSES ROW-LEVEL SECURITY. It exists for exactly one reason:
// integration credentials are protected by a column-level REVOKE (migration
// 0007), so even an Owner's authenticated session cannot read the ciphertext.
// Reading it requires an identity that outranks RLS.
//
// RULES FOR USING THIS:
//   1. Never import it into a Client Component. There is no "use client" path
//      to it, and the key must never reach a browser bundle.
//   2. Every query made with it MUST filter organization_id explicitly. RLS is
//      not there to catch a mistake — the tenant scoping is entirely on you.
//   3. Do not reach for it for convenience. If a normal client can do the job,
//      use the normal client.
//
// Returns null when SUPABASE_SERVICE_ROLE_KEY is unset, so the feature degrades
// to "not configured" instead of crashing.
// =============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "./env";

let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  // Accepts both the current sb_secret_... key and the legacy service_role JWT.
  const secretKey = supabaseSecretKey();

  if (!url || !secretKey) return null;
  if (cached) return cached;

  cached = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}

export function isAdminClientConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseSecretKey());
}
