import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { listTeamMembers } from "@/lib/jobs/queries";
import { listMessageTemplates } from "@/lib/communications/queries";
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
  const [{ settings, failed }, members, { templates }] = await Promise.all([
    getOrganizationSettings(organizationId),
    listTeamMembers(organizationId),
    // Read so the reminder section can say whether it will actually send anything.
    // The timing here decides WHEN; the words live in the template library, and
    // without an active one this setting sends nothing.
    listMessageTemplates(organizationId),
  ]);

  if (failed) return <ErrorState message="Couldn't load these settings." />;

  return (
    <RecruitmentForm
      initial={{
        currency: settings.currency,
        default_recruiter_id: settings.default_recruiter_id,
        default_application_stage: settings.default_application_stage,
        default_interview_duration_minutes: settings.default_interview_duration_minutes,
        interview_reminder_hours: settings.communication_settings.interviewReminderHours,
        interview_reminder_channels: settings.communication_settings.interviewReminderChannels,
      }}
      members={members.map((member) => ({ id: member.id, name: member.name }))}
      reminderTemplateActive={templates.some(
        (template) => template.active && template.event_key === "interview_reminder"
      )}
    />
  );
}
