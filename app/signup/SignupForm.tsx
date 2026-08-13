"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormError } from "@/components/states";

const MIN_PASSWORD_LENGTH = 8;

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setBusy(false);
      return;
    }

    // With email confirmation enabled, signUp returns a user but no session —
    // the organization is created after they confirm and land on /onboarding.
    if (!data.session) {
      setAwaitingConfirmation(true);
      setBusy(false);
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  if (awaitingConfirmation) {
    return (
      <div className="ai-panel">
        <p style={{ fontSize: 14 }}>
          Check <strong>{email}</strong> for a confirmation link. Once you confirm, you&apos;ll be
          taken straight to setting up your workspace.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormError message={error} />

      <div className="field">
        <label className="label" htmlFor="name">
          Your name
        </label>
        <div className="control">
          <input
            id="name"
            className="input"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

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
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p className="help has-text-secondary">At least {MIN_PASSWORD_LENGTH} characters.</p>
      </div>

      <button
        type="submit"
        className={`button is-primary is-fullwidth ${busy ? "is-loading" : ""}`}
        disabled={busy}
      >
        Create account
      </button>
    </form>
  );
}
