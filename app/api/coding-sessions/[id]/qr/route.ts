import { type NextRequest } from "next/server";
import QRCode from "qrcode";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { getSessionDetail } from "@/lib/coding/queries";
import { checkSessionAccess } from "@/lib/coding/session";
import { buildCandidateUrl } from "@/lib/coding/token";

/**
 * GET /api/coding-sessions/:id/qr — the QR code, as an SVG.
 *
 * WHY A ROUTE AND NOT A CLIENT-SIDE RENDER.
 *
 * The QR encodes a signed access link. Generating it in the browser would mean
 * shipping the link into client state and into a canvas, where a screen-sharing
 * interviewer's dev tools, a browser extension or a stray screenshot could pick
 * it up in a form that is trivially copyable. Rendered here it is an <img src>
 * pointing at an authenticated endpoint: the interviewer's own session is what
 * authorises it, and the bytes on the wire are a picture.
 *
 * It also means no QR library reaches the client bundle at all.
 *
 * SVG rather than PNG deliberately: this image is projected on a Google Meet
 * screen share and then photographed by a phone camera, and a vector stays
 * scannable at whatever size the interviewer's window happens to be.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getSessionDetail({
      organizationId: membership.organization.id,
      sessionId: id,
    });
    if (!detail) return jsonError("Coding session not found.", 404);

    // A closed session gets no QR code. Rendering one would put a scannable
    // image of a dead link on screen, and the candidate would spend the next
    // minute pointing a camera at it.
    const access = checkSessionAccess({
      status: detail.status,
      expiresAt: detail.expires_at,
    });
    if (!access.open) {
      return jsonError("This coding round is no longer open, so it has no link.", 409);
    }

    const url = await buildCandidateUrl({ sessionId: id, origin: request.nextUrl.origin });
    if (!url) {
      return jsonError("Could not build the candidate link for this session.", 503);
    }

    const svg = await QRCode.toString(url, {
      type: "svg",
      // A phone camera at arm's length across a shared screen is a poor read.
      // Medium error correction survives the compression a video call applies;
      // the wider quiet zone is what makes it detectable against a page.
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
    });

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        // Never cached. The URL is a credential, and a cached copy in a proxy or
        // a browser's disk cache outlives the session it belongs to.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
