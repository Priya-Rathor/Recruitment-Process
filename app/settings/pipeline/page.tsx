import Link from "next/link";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getSlaConfig } from "@/lib/pipeline/queries";
import { editableSlaRows } from "@/lib/pipeline/sla";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { SlaSettings } from "@/app/pipeline/SlaSettings";

export const metadata = { title: "Pipeline settings · Recruitment OS" };
export const dynamic = "force-dynamic";

/**
 * MODULE 17 RETROFIT, item 4.
 *
 * The spec: "Point this module's /settings/pipeline page at the
 * pipeline_sla_config table Module 10 already created rather than creating a
 * duplicate."
 *
 * So this page reuses Module 10's `getSlaConfig()`, its `editableSlaRows()`
 * shaping AND its `SlaSettings` component, which already posts to
 * /api/pipeline/sla. There is no second table, no second API and no second
 * form — a duplicate would give the product two places to set the same number,
 * and they would disagree the first time somebody used the other one.
 */
export default async function PipelineSettingsPage() {
  const membership = await requireMembershipOrRedirect();
  const canEdit = hasRole(membership.role, ["owner", "admin"]);

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/pipeline"
      title="Pipeline SLA"
      description="How long an application should sit in each stage before it needs attention."
    >
      {!canEdit ? (
        <RestrictedPanel what="pipeline settings" />
      ) : (
        <PipelineBody organizationId={membership.organization.id} />
      )}
    </SettingsShell>
  );
}

async function PipelineBody({ organizationId }: { organizationId: string }) {
  const config = await getSlaConfig(organizationId);

  return (
    <>
      <SlaSettings rows={editableSlaRows(config)} canEdit />

      <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
        These targets drive the aging colours on the{" "}
        <Link href="/pipeline">pipeline board</Link>, the overdue queue on the{" "}
        <Link href="/dashboard">dashboard</Link>, and the bottleneck detection in{" "}
        <Link href="/analytics">analytics</Link> — all from this one setting.
      </p>
    </>
  );
}
