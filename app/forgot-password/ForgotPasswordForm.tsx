"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FormError } from "@/components/states";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (resetError) {
      setError("We couldn't send that email right now. Please try again.");
      setBusy(false);
      return;
    }

    // Always report success — confirming which addresses exist would leak
    // account existence to anyone who can load this page.
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="ai-panel">
        <p style={{ fontSize: 14 }}>
          If an account exists for <strong>{email}</strong>, a reset link is on its way.
        </p>
      </div>
    );
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
      <button
        type="submit"
        className={`button is-primary is-fullwidth ${busy ? "is-loading" : ""}`}
        disabled={busy}
      >
        Send reset link
      </button>
    </form>
  );
}
