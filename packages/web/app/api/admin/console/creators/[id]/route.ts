import type { CreatorDetailResponse } from "@/lib/admin-console/creators-types";
import { creatorAccess, creatorErrorResponse, isOptionalText, joinUrl, ownerJson, parseId, requireOwner, requireOwnerMutation } from "@/lib/admin-console/creators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Creator sheet: links (with absolute join URLs), grants not used yet, joined people. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;
  const id = parseId((await params).id);
  if (id === null) return ownerJson({ error: "invalid_id" }, 400);
  try {
    const detail = creatorAccess().creatorDetail(id);
    if (!detail) return ownerJson({ error: "not_found" }, 404);
    const linkUrls: Record<number, string> = {};
    for (const link of detail.links) linkUrls[link.id] = joinUrl(link.code);
    const body: CreatorDetailResponse = { ...detail, linkUrls };
    return ownerJson(body);
  } catch (error) {
    return creatorErrorResponse(error, "detail");
  }
}

/** Edit or archive. Only known fields are passed on; the service checks lengths and formats. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireOwnerMutation(request, { body: true });
  if (!guard.ok) return guard.response;
  const id = parseId((await params).id);
  if (id === null) return ownerJson({ error: "invalid_id" }, 400);
  const { name, channelUrl, notes, archived } = guard.body;
  if (name !== undefined && typeof name !== "string") return ownerJson({ error: "invalid_name" }, 400);
  if (!isOptionalText(channelUrl)) return ownerJson({ error: "invalid_channel_url" }, 400);
  if (!isOptionalText(notes)) return ownerJson({ error: "invalid_notes" }, 400);
  if (archived !== undefined && typeof archived !== "boolean") return ownerJson({ error: "invalid_archived" }, 400);
  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(channelUrl !== undefined ? { channelUrl } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(archived !== undefined ? { archived } : {}),
  };
  try {
    const creator = creatorAccess().updateCreator(id, patch);
    return creator ? ownerJson({ creator }) : ownerJson({ error: "not_found" }, 404);
  } catch (error) {
    return creatorErrorResponse(error, "update");
  }
}
