"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Full refresh so middleware re-evaluates and server components drop
    // any session-derived data from their render cache.
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      className={`button is-small ${busy ? "is-loading" : ""}`}
      onClick={signOut}
      disabled={busy}
    >
      Sign out
    </button>
  );
}
