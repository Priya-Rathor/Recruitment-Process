import Link from "next/link";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { ErrorState, EmptyState } from "@/components/states";
import { describeProcessors, CATEGORY_LABELS } from "@/lib/privacy/providers";
import { describeRetention } from "@/lib/privacy/retention";
import { describeConsent } from "@/lib/privacy/consent";
import { getPrivacyLog } from "@/lib/privacy/queries";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { PrivacyForm } from "./PrivacyForm";

export const metadata = { title: "Privacy & consent" };
export const dynamic = "force-dynamic";

export default async function PrivacySettingsPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/privacy"
      title="Privacy & consent"
      description="How candidate voice-call and interview data is handled."
    >
      {!hasRole(membership.role, ["owner", "admin"]) ? (
        <RestrictedPanel what="privacy settings" />
      ) : (
        <PrivacyBody organizationId={membership.organization.id} />
      )}
    </SettingsShell>
  );
}

async function PrivacyBody({ organizationId }: { organizationId: string }) {
  const [{ settings, failed }, bolna, log] = await Promise.all([
    getOrganizationSettings(organizationId),
    getBolnaStatus(organizationId),
    getPrivacyLog({ organizationId, limit: 25 }),
  ]);

  if (failed) return <ErrorState message="Couldn't load these settings." />;

  const privacy = settings.privacy_settings;

  // Only the connection STATUS is read, never a credential — see the header of
  // lib/privacy/providers.ts. getStatus() returns a status string by design.
  const processors = describeProcessors({
    bolna: bolna.status === "connected",
  });

  return (
    <>
      {/*
        The summary panel. Nine sections of switches do not answer "so what
        actually happens on a call tomorrow" — three sentences do, and an admin
        who is about to change something should be able to read the current state
        before they touch it.
      */}
      <div className="card mb-4">
        <h3 className="title is-6 mb-3">What happens on a screening call today</h3>
        <p style={{ fontSize: 14, marginBottom: 8 }}>{describeConsent(privacy)}</p>
        <p style={{ fontSize: 14, marginBottom: 8 }}>{describeRetention(privacy)}</p>
        <p style={{ fontSize: 14 }}>
          {privacy.aiDisclosure.enabled
            ? "The candidate is also told their responses may be analysed automatically."
            : "The AI-analysis disclosure is switched off. The candidate is still told the call is automated and may be recorded."}
        </p>
      </div>

      {/* The form carries §1-§7 and §9. */}
      <PrivacyForm initial={privacy} />

      {/* ------------------------------------------- §8 Third-party processing */}
      <section id="processors" className="card mb-4">
        <h3 className="title is-6 mb-2">8. Data sharing &amp; third-party services</h3>
        <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
          The providers involved in processing an interview. This is the list a data protection
          officer needs — which processors receive personal data, what data, and why. No API keys or
          credentials are shown here or anywhere else in the product.
        </p>

        {processors.map((processor) => (
          <div
            key={processor.key}
            className="mb-4"
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--card-radius)",
              padding: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <p style={{ fontSize: 15, fontWeight: 600 }}>{processor.name}</p>
                <p className="has-text-secondary" style={{ fontSize: 12 }}>
                  {CATEGORY_LABELS[processor.category]}
                </p>
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: processor.connected
                    ? "var(--status-connected-text)"
                    : "var(--color-text-secondary)",
                }}
              >
                {processor.statusLabel}
              </span>
            </div>

            <p style={{ fontSize: 13, marginTop: 12 }}>
              <strong>Purpose:</strong> {processor.purpose}
            </p>

            <p style={{ fontSize: 13, marginTop: 8, fontWeight: 600 }}>Data processed</p>
            <ul className="has-text-secondary" style={{ fontSize: 13 }}>
              {processor.dataProcessed.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>

            {processor.conditionalOn && (
              <p className="has-text-secondary" style={{ fontSize: 12, marginTop: 8 }}>
                Only receives data when: {processor.conditionalOn}.
              </p>
            )}
          </div>
        ))}

        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Only providers this product actually integrates are listed. Speech recognition and voice
          generation for a screening call happen inside the telephony provider&apos;s own platform;
          if a separate speech provider is added, it appears here in the same change.{" "}
          <Link href="/settings/integrations">Manage connections</Link>.
        </p>
      </section>

      {/* --------------------------------------------------- §10 Privacy log */}
      <section id="log" className="card">
        <h3 className="title is-6 mb-2">10. Privacy activity log</h3>
        <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
          Consent, recordings, transcript access, exports and deletions. Append-only — entries
          cannot be edited or removed, including by an Owner.
        </p>

        {log.failed ? (
          /*
            An error state, NOT an empty list. An empty privacy log reads as
            "nothing sensitive has happened", which would be a false statement to
            somebody auditing a subject access request.
          */
          <ErrorState message="Couldn't load the privacy log. It has not been cleared — this is a read failure." />
        ) : log.rows.length === 0 ? (
          <EmptyState
            headline="No privacy events yet"
            message="Consent, recording and data-access events appear here as they happen."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table is-fullwidth" style={{ fontSize: 14 }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Who</th>
                </tr>
              </thead>
              <tbody>
                {log.rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td>{row.description}</td>
                    <td className="has-text-secondary">{row.actorLabel ?? "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
          The full audit trail, including non-privacy events, is at{" "}
          <Link href="/audit-log">the audit log</Link>.
        </p>
      </section>
    </>
  );
}
