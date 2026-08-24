import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { DEFAULT_SCREENING_SETTINGS, getOrganizationSettings } from "@/lib/settings/queries";
import { normalizeDefaultCallData, resolveCallDataPrecedence } from "@/lib/voice/callData";
import { loadJobScreeningOverrides } from "@/lib/voice/queries";

/**
 * POST /api/settings/voice-agents/preview — the Default Call Data precedence table.
 *
 * A POST for a read, deliberately. The preview has to answer "which values would
 * this job actually use?" for the configuration CURRENTLY IN THE FORM, including
 * edits nobody has saved yet — a preview computed from the stored row would show
 * the admin the consequences of the settings they just replaced, which is the
 * opposite of useful. So the unsaved Default Call Data comes up in the body.
 *
 * The job side is read from the database (job_hiring_stages, job_screening_
 * questions) rather than sent by the client: those are facts about the job, and a
 * client that could assert them could make the preview say anything.
 *
 * Precedence itself is resolved by lib/voice/callData.ts — the SAME function the
 * dialling path calls, which is what stops the preview and the real call from
 * disagreeing.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const organizationId = membership.organization.id;

    let body: Record<string, unknown> = {};
    try {
      body = ((await request.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return jsonError("Send the preview inputs as JSON.", 400);
    }

    const jobId = typeof body.jobId === "string" ? body.jobId : null;
    if (!jobId) return jsonError("Pick a job to preview.", 400);

    const [job, { settings: orgSettings }] = await Promise.all([
      loadJobScreeningOverrides({ organizationId, jobId }),
      getOrganizationSettings(organizationId),
    ]);

    if (!job) return jsonError("That job doesn't exist.", 404);

    const screening = orgSettings.screening_settings ?? DEFAULT_SCREENING_SETTINGS;

    const rows = resolveCallDataPrecedence({
      org: {
        // Normalised, not trusted: this arrived from a browser.
        callData: normalizeDefaultCallData(body.callData),
        orgLanguage: screening.language,
        orgMaxAttempts: screening.maxAttempts,
        agentSystemPrompt:
          typeof body.agentSystemPrompt === "string" ? body.agentSystemPrompt : "",
        agentCompanyName:
          typeof body.agentCompanyName === "string" && body.agentCompanyName.trim()
            ? body.agentCompanyName.trim()
            : membership.organization.name,
      },
      job,
    });

    return NextResponse.json({
      data: {
        job: {
          id: job.jobId,
          title: job.jobTitle,
          screeningEnabled: job.screeningEnabled,
        },
        rows,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
