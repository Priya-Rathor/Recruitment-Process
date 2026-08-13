"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, FormError } from "@/components/states";
import type { MembershipWithOrganization } from "@/lib/types";

export function OrganizationSwitcher({
  memberships,
  activeOrganizationId,
}: {
  memberships: MembershipWithOrganization[];
  activeOrganizationId: string | null;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(organizationId: string) {
    setPendingId(organizationId);
    setError(null);

    const response = await fetch("/api/organizations/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: organizationId }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not switch organization. Please try again.");
      setPendingId(null);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (memberships.length === 0) {
    return (
      <EmptyState
        message="You don't belong to any organization yet."
        action={
          <a className="button is-primary" href="/onboarding">
            Create a workspace
          </a>
        }
      />
    );
  }

  return (
    <div>
      <FormError message={error} />
      {memberships.map((membership) => {
        const isActive = membership.organization.id === activeOrganizationId;
        return (
          <div
            key={membership.organization.id}
            className="is-flex is-align-items-center is-justify-content-space-between py-3"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <div>
              <p style={{ fontWeight: 600 }}>{membership.organization.name}</p>
              <p className="has-text-secondary" style={{ fontSize: 13 }}>
                <span style={{ textTransform: "capitalize" }}>{membership.role}</span>
                {membership.organization.industry ? ` · ${membership.organization.industry}` : ""}
              </p>
            </div>
            {isActive ? (
              <span className="tag is-success is-light">Current</span>
            ) : (
              <button
                type="button"
                className={`button is-small is-primary ${
                  pendingId === membership.organization.id ? "is-loading" : ""
                }`}
                onClick={() => switchTo(membership.organization.id)}
                disabled={pendingId !== null}
              >
                Switch
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
