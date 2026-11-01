import type { CreateLinkResponse } from "@/lib/admin-console/creators-types";
import { creatorAccess, creatorErrorResponse, isOptionalText, joinUrl, ownerJson, parseId, requireOwnerMutation } from "@/lib/admin-console/creators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** New invite link (maxUses 1-500, expiresInDays 1-90, optional label and email lock). Owner-only response. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await requireOwnerMutation(request, { body: true });
  if (!guard.ok) return guard.response;
  const id = parseId((await params).id);
  if (id === null) return ownerJson({ error: "invalid_id" }, 400);
  const { label, maxUses, expiresInDays, lockedEmail } = guard.body;
  if (!isOptionalText(label)) return ownerJson({ error: "invalid_label" }, 400);
  if (!isOptionalText(lockedEmail)) return ownerJson({ error: "invalid_locked_email" }, 400);
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses)) return ownerJson({ error: "invalid_max_uses" }, 400);
  if (typeof expiresInDays !== "number" || !Number.isInteger(expiresInDays)) return ownerJson({ error: "invalid_expires_in_days" }, 400);
  try {
    const link = creatorAccess().createLink(id, { label, maxUses, expiresInDays, lockedEmail, actorUserId: guard.userId });
    if (!link) return ownerJson({ error: "not_found" }, 404);
    const body: CreateLinkResponse = { link, url: joinUrl(link.code) };
    return ownerJson(body, 201);
  } catch (error) {
    return creatorErrorResponse(error, "create_link");
  }
}
