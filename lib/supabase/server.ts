// Server-side Supabase client — for use in Server Components, Route Handlers,
// and Server Actions. Reads/writes the auth cookie via Next.js's cookies().
//
// Module 1 will add getCurrentOrganizationId()/role-check helpers on top of
// this client — every later module's API routes must call those instead of
// trusting any client-supplied organization_id.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from a Server Component during render, where
            // cookies cannot be set. Safe to ignore because proxy.ts refreshes
            // the session on every request.
          }
        },
      },
    }
  );
}
