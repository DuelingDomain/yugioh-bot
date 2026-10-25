import type { ResendResponse } from "@/lib/admin-console/creators-types";
import { busyResponse, creatorAccess, creatorErrorResponse, ownerJson, parseId, requireOwnerMutation } from "@/lib/admin-console/creators";
import { releaseOwnerSends, reserveOwnerSends } from "@/lib/creator-send-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner Resend of a failed or expired grant, under the shared send budget. No body. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await requireOwnerMutation(request, { body: false });
  if (!guard.ok) return guard.response;
  const id = parseId((await params).id);
  if (id === null) return ownerJson({ error: "invalid_id" }, 400);
  const wait = reserveOwnerSends(1);
  if (wait !== null) return busyResponse(wait);
  try {
    const result = await creatorAccess().resendGrant(id);
    if (result.kind === "not_resendable" || result.kind === "full") releaseOwnerSends(1);
    const body: ResendResponse = { result: result.kind };
    return ownerJson(body);
  } catch (error) {
    releaseOwnerSends(1);
    return creatorErrorResponse(error, "resend");
  }
}
