import { type NextRequest } from "next/server";
import QRCode from "qrcode";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { getFormDetail } from "@/lib/forms/queries";
import { buildApplyUrl } from "@/lib/forms/token";

/**
 * GET /api/forms/:id/qr — the public application link, as an SVG QR code.
 *
 * A ROUTE AND NOT A CLIENT-SIDE RENDER, for the same reasons as
 * /api/coding-sessions/:id/qr: the image is served from an endpoint the
 * recruiter's own session authorises, so no QR library reaches the client
 * bundle and the link never has to be put into client state to be drawn.
 *
 * SVG rather than PNG because this one genuinely gets printed — on a poster, a
 * flyer, a careers-fair banner — and a vector stays scannable at whatever size
 * somebody scales it to.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getFormDetail({ organizationId: membership.organization.id, formId: id });
    if (!detail) return jsonError("Form not found.", 404);

    // A draft or disabled form gets no QR code. Printing a scannable image of a
    // dead link is worse than showing nothing: somebody puts it on a poster.
    if (detail.form.status !== "published") {
      return jsonError("This form isn't published, so it has no public link yet.", 409);
    }

    const url = await buildApplyUrl({
      formId: detail.form.id,
      tokenVersion: detail.form.token_version,
      origin: request.nextUrl.origin,
    });

    if (!url) return jsonError("Could not build the public link for this form.", 503);

    const svg = await QRCode.toString(url, {
      // Medium correction survives a phone camera at an angle, and the wider
      // quiet zone is what makes the code detectable against a printed page.
      errorCorrectionLevel: "M",
      type: "svg",
      margin: 2,
      width: 320,
    });

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        // Never cached. The URL is a credential of sorts, and a cached copy in a
        // proxy would outlive a regenerated link.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
