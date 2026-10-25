import type { RevokeLinkResponse } from "@/lib/admin-console/creators-types";
import { creatorAccess, creatorErrorResponse, ownerJson, parseId, requireOwnerMutation } from "@/lib/admin-console/creators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop new uses of a link at once and revoke its unused Clerk invitations (best effort). No body. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; linkId: string }> }): Promise<Response> {
  const guard = await requireOwnerMutation(request, { body: false });
  if (!guard.ok) return guard.response;
  const raw = await params;
  const id = parseId(raw.id);
  const linkId = parseId(raw.linkId);
  if (id === null || linkId === null) return ownerJson({ error: "invalid_id" }, 400);
  try {
    const result = await creatorAccess().revokeLink(id, linkId);
    if (!result) return ownerJson({ error: "not_found" }, 404);
    const body: RevokeLinkResponse = { revoked: true, invitationsRevoked: result.invitationsRevoked };
    return ownerJson(body);
  } catch (error) {
    return creatorErrorResponse(error, "revoke_link");
  }
}
