import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { listTeamMembers } from "@/lib/jobs/queries";
import { ErrorState } from "@/components/states";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { RecruitmentForm } from "./RecruitmentForm";

export const metadata = { title: "Recruitment settings" };
export const dynamic = "force-dynamic";

export default async function RecruitmentSettingsPage() {
  const membership = await requireMembershipOrRedirect();

  const body = !hasRole(membership.role, ["owner", "admin"]) ? (
    <RestrictedPanel what="recruitment defaults" />
  ) : (
    <RecruitmentBody organizationId={membership.organization.id} />
  );

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/recruitment"
      title="Recruitment defaults"
      description="Applied when nobody chooses otherwise. Changing them never alters existing records."
    >
      {body}
    </SettingsShell>
  );
}

async function RecruitmentBody({ organizationId }: { organizationId: string }) {
  const [{ settings, failed }, members] = await Promise.all([
    getOrganizationSettings(organizationId),
    listTeamMembers(organizationId),
  ]);

  if (failed) return <ErrorState message="Couldn't load these settings." />;

  return (
    <RecruitmentForm
      initial={{
        currency: settings.currency,
        default_recruiter_id: settings.default_recruiter_id,
        default_application_stage: settings.default_application_stage,
        default_interview_duration_minutes: settings.default_interview_duration_minutes,
      }}
      members={members.map((member) => ({ id: member.id, name: member.name }))}
    />
  );
}
