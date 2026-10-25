import { log } from "@yugidraft/shared/observability";
import { CreatorAccessError, LINK_CODE_PATTERN, createCreatorAccessService, type LinkState } from "@yugidraft/shared/services/creator-access";
import { normalizeJoinEmail } from "@yugidraft/shared/util/join-email";
import { clientIpKey } from "@/lib/rate-limit";
import { releaseJoinSend, reserveJoinSend, takeJoinPost } from "@/lib/creator-send-limit";
import { getDb } from "@/lib/db";
import { webOrigin } from "@/lib/existing-player";
import { readSmallJsonObject } from "@/lib/read-small-body";
import type { BusyResponse, JoinResponse } from "@/lib/admin-console/creators-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2048;

/**
 * Public creator link join (contract in creators-types.ts). Every body is fixed: it never holds a ticket, invitation
 * URL, invitation id or grant id, and it never says whether an email already has an account or a grant.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  const reply = (body: JoinResponse, status: number) => Response.json(body, { status, headers });
  const busy = (retryAfterSeconds: number) => {
    headers.set("retry-after", String(retryAfterSeconds));
    const body: BusyResponse = { error: "busy", retryAfterSeconds };
    return reply(body, 429);
  };
  const sent = () => reply({ status: "sent" }, 200);
  const closed = (state: Exclude<LinkState, "open">) => reply({ status: state }, 409);
  const unknown = () => reply({ status: "revoked" }, 404);

  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") return reply({ error: "unsupported_media_type" }, 415);
  let origin: string | null = null;
  try { origin = webOrigin(); } catch { /* WEB_URL missing: refuse below. */ }
  if (!origin || request.headers.get("origin") !== origin) return reply({ error: "invalid_origin" }, 403);
  const postWait = takeJoinPost(request);
  if (postWait !== null) return busy(postWait);

  const data = await readSmallJsonObject(request, MAX_BODY_BYTES);
  if (!data) return reply({ error: "invalid_email" }, 400);
  if (typeof data.company === "string" && data.company.length > 0) return sent();
  const email = normalizeJoinEmail(data.email);
  if (!email) return reply({ error: "invalid_email" }, 400);

  const { code } = await params;
  if (!LINK_CODE_PATTERN.test(code)) return unknown();
  try {
    const service = createCreatorAccessService(getDb());
    // A closed link answers before any budget is used, so a full link never reads as "busy".
    const view = service.publicLink(code);
    if (!view) return unknown();
    if (view.state !== "open") return closed(view.state);
    const sendWait = reserveJoinSend(code);
    if (sendWait !== null) return busy(sendWait);
    // claimLinkGrant is synchronous: nothing else runs between the reservation and its release.
    let claim: ReturnType<typeof service.claimLinkGrant>;
    try {
      claim = service.claimLinkGrant(code, email, { ipKey: clientIpKey(request) });
    } catch (error) {
      releaseJoinSend(code);
      // An address with no usable dedupe key (for example "+tag@example.com").
      if (error instanceof CreatorAccessError && error.code === "invalid_email") return reply({ error: "invalid_email" }, 400);
      throw error;
    }
    if (claim.kind !== "claimed") releaseJoinSend(code);
    switch (claim.kind) {
      case "already": return sent();
      case "full": case "expired": case "revoked": return closed(claim.kind);
      case "not_found": return unknown();
      case "claimed": break;
    }
    try {
      const result = await service.sendGrant(claim.grantId);
      if (result.kind === "failed") {
        if (result.retryAfterMs !== null) headers.set("retry-after", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
        return reply({ error: "retry_later" }, 503);
      }
      return sent();
    } catch (error) {
      // A setup error (Clerk key or WEB_URL missing) throws before any Clerk call: give the send back.
      if (error instanceof CreatorAccessError) releaseJoinSend(code);
      log("warn", "[join] invitation send failed");
      return reply({ error: "retry_later" }, 503);
    }
  } catch {
    // Never log the email or database detail.
    log("error", "[join] request failed");
    return reply({ error: "server_error" }, 500);
  }
}
