"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormError } from "@/components/states";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "We couldn't complete that sign-in. Please try again.",
  missing_code: "That sign-in link is incomplete. Please try again.",
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  // Only same-origin relative paths — never redirect to an arbitrary URL.
  const next = nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    ERROR_MESSAGES[searchParams.get("error") ?? ""] ?? null
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      // Generic on purpose: do not reveal whether the address has an account.
      setError("That email and password combination didn't work.");
      setBusy(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (oauthError) {
      setError("Google sign-in isn't available right now. Use your email and password instead.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormError message={error} />

      <div className="field">
        <label className="label" htmlFor="email">
          Work email
        </label>
        <div className="control">
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <div className="control">
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p className="help">
          <Link href="/forgot-password">Forgot your password?</Link>
        </p>
      </div>

      <button
        type="submit"
        className={`button is-primary is-fullwidth ${busy ? "is-loading" : ""}`}
        disabled={busy}
      >
        Sign in
      </button>

      <button
        type="button"
        className="button is-fullwidth mt-3"
        onClick={handleGoogle}
        disabled={busy}
      >
        Continue with Google
      </button>
    </form>
  );
}
