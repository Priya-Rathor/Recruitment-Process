"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";

export function NewClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slaDays, setSlaDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, feedback_sla_days: slaDays }),
    });

    const payload = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not create that client.");
      return;
    }

    setName("");
    setOpen(false);
    router.push(`/clients/${payload.data.id}`);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="mb-4">
        <button type="button" className="button is-primary" onClick={() => setOpen(true)}>
          Add client
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card mb-4">
      <h2 className="title is-5">Add a client</h2>
      <FormError message={error} />

      <div className="columns">
        <div className="column">
          <label className="label" htmlFor="client-name">
            Company name
          </label>
          <input
            id="client-name"
            className="input"
            type="text"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="column is-one-third">
          <label className="label" htmlFor="client-sla">
            Feedback SLA (days)
          </label>
          <input
            id="client-sla"
            className="input"
            type="number"
            min={0}
            max={90}
            value={slaDays}
            onChange={(event) => setSlaDays(Number(event.target.value))}
          />
          <p className="help has-text-secondary">
            How long they should take to respond to a submission.
          </p>
        </div>
      </div>

      <div className="buttons">
        <button
          type="submit"
          className={`button is-primary ${busy ? "is-loading" : ""}`}
          disabled={busy || name.trim().length === 0}
        >
          Add client
        </button>
        <button type="button" className="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
