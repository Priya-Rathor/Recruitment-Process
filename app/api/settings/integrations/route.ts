import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { getAllIntegrationHealth } from "@/lib/settings/integrations";

/**
 * GET /api/settings/integrations — health for all five providers.
 *
 * "Manage integrations/credentials | Owner Yes | Admin Yes | Recruiter No |
 * Viewer No". Read is restricted too, not just write: the response carries
 * masked hints, error messages and account emails, and the spec's own test is
 * "Recruiter cannot read integration secrets". The RLS policy on
 * organization_integrations restricts SELECT to Owner/Admin as well, so this
 * check is for the readable 403 rather than the boundary.
 *
 * NOTHING HERE RETURNS A CREDENTIAL. The adapters return masked hints only, the
 * ciphertext is never selected into a status object, and the column carries a
 * database-level REVOKE on top.
 */
export async function GET() {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const integrations = await getAllIntegrationHealth(membership.organization.id);

    return NextResponse.json({ data: integrations, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}
