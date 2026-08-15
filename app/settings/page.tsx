import { redirect } from "next/navigation";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { visibleSections } from "./SettingsShell";

export const dynamic = "force-dynamic";

/**
 * /settings — sends you to the first section your role can actually open.
 *
 * An Owner lands on Organization; a Recruiter lands on Team & permissions,
 * because Organization is not theirs. A landing page listing sections they
 * cannot open would be a menu of closed doors.
 */
export default async function SettingsIndexPage() {
  const membership = await requireMembershipOrRedirect();
  const sections = visibleSections(membership.role);

  redirect(sections[0]?.href ?? "/settings/notifications");
}
