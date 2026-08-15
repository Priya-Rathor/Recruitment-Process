import Link from "next/link";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";
import { ErrorState } from "@/components/states";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { RetentionForm } from "./RetentionForm";

export const metadata = { title: "Security & data · Recruitment OS" };
export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/security"
      title="Security & data"
      description="How long data is kept, and what the product does to protect it."
    >
      {!hasRole(membership.role, ["owner", "admin"]) ? (
        <RestrictedPanel what="security settings" />
      ) : (
        <SecurityBody organizationId={membership.organization.id} />
      )}
    </SettingsShell>
  );
}

async function SecurityBody({ organizationId }: { organizationId: string }) {
  const { settings, failed } = await getOrganizationSettings(organizationId);
  if (failed) return <ErrorState message="Couldn't load these settings." />;

  const encryptionReady = isEncryptionConfigured();

  return (
    <>
      <div className="card mb-4">
        <h3 className="title is-6 mb-3">What&apos;s protected</h3>
        <ul style={{ fontSize: 14 }}>
          <li className="mb-2">
            <strong>Integration credentials</strong> are AES-GCM encrypted and can never be read
            back through the API or a browser session — a database-level revoke sits on top of the
            access rules.{" "}
            {!encryptionReady && (
              <span style={{ color: "var(--color-error)" }}>
                Encryption isn&apos;t configured on this server, so no credentials can be stored.
              </span>
            )}
          </li>
          <li className="mb-2">
            <strong>Every organization&apos;s data is isolated at the database</strong>, not just in
            the application. A query that forgot its filter still cannot cross tenants.
          </li>
          <li className="mb-2">
            <strong>Screening calls always disclose</strong> that they are automated and may be
            recorded, before anything is recorded. That has no setting.
          </li>
          <li>
            <strong>The audit log is append-only.</strong> Nobody can edit or delete an entry —
            not an Owner, and not the server.
          </li>
        </ul>
        <Link className="button is-small mt-3" href="/audit-log">
          Open the audit log
        </Link>
      </div>

      <h3 className="title is-6 mb-3">Data retention</h3>
      <RetentionForm initial={settings.retention_settings} />

      {/*
        DANGER ZONE — separated from the Save button above, per the spec:
        "Dangerous actions live in a separate Danger Zone at the bottom of a
        settings page, never beside normal Save buttons."
      */}
      <div
        className="card mt-5"
        style={{ borderColor: "var(--color-error)" }}
      >
        <h3 className="title is-6 mb-2" style={{ color: "var(--color-error)" }}>
          Danger zone
        </h3>

        <p style={{ fontSize: 14, marginBottom: 12 }}>
          <strong>Disconnecting an integration</strong> stops candidate-facing features
          immediately. The integrations page lists what depends on each one before you confirm.
        </p>
        <Link className="button is-small" href="/settings/integrations">
          Manage integrations
        </Link>

        <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
          Deleting an organization, exporting all data, and erasing an individual&apos;s records on
          request are part of the Privacy &amp; Compliance work that follows this module. They
          aren&apos;t available here yet, and no button below pretends otherwise.
        </p>
      </div>
    </>
  );
}
