"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);

    const response = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "This invite link is no longer valid.");
      setBusy(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <FormError message={error} />
      <button
        type="button"
        className={`button is-primary ${busy ? "is-loading" : ""}`}
        onClick={accept}
        disabled={busy}
      >
        Accept invite
      </button>
    </div>
  );
}
