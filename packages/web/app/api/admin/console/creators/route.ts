import { CreatorAccessError } from "@yugidraft/shared/services/creator-access";
import { normalizeJoinEmail } from "@yugidraft/shared/util/join-email";
import type { AddEmailResult, CreateCreatorResponse } from "@/lib/admin-console/creators-types";
import { busyResponse, creatorAccess, creatorErrorResponse, isOptionalText, loadCreators, ownerJson, requireOwnerMutation } from "@/lib/admin-console/creators";
import { sectionRouteWithQuery } from "@/lib/admin-console/section";
import { releaseOwnerSends, reserveOwnerSends } from "@/lib/creator-send-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Section "creators" (?start=<local midnight epoch ms>). */
export const GET = sectionRouteWithQuery(loadCreators);

/** Create a creator. An optional email becomes an allowlist grant and is sent now, under the shared send budget. */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireOwnerMutation(request, { body: true });
  if (!guard.ok) return guard.response;
  const { name, channelUrl, notes, email: rawEmail } = guard.body;
  if (typeof name !== "string") return ownerJson({ error: "invalid_name" }, 400);
  if (!isOptionalText(channelUrl)) return ownerJson({ error: "invalid_channel_url" }, 400);
  if (!isOptionalText(notes)) return ownerJson({ error: "invalid_notes" }, 400);
  if (!isOptionalText(rawEmail)) return ownerJson({ error: "invalid_email" }, 400);
  let email: string | null = null;
  if (typeof rawEmail === "string" && rawEmail.trim() !== "") {
    email = normalizeJoinEmail(rawEmail);
    if (!email) return ownerJson({ error: "invalid_email" }, 400);
  }
  // Check the budget before anything is written, so a busy answer leaves no half-made creator.
  if (email) {
    const wait = reserveOwnerSends(1);
    if (wait !== null) return busyResponse(wait);
  }
  const service = creatorAccess();
  let creator;
  try {
    creator = service.createCreator({ name, channelUrl, notes, actorUserId: guard.userId });
  } catch (error) {
    if (email) releaseOwnerSends(1);
    return creatorErrorResponse(error, "create");
  }
  const body: CreateCreatorResponse = { creator };
  if (email) {
    let result: AddEmailResult;
    try {
      [result = { email, outcome: "failed" }] = await service.addAllowlistEmails(creator.id, [email], guard.userId);
    } catch (error) {
      // CreatorAccessError (setup or archived) is thrown before any send: give the send back.
      if (error instanceof CreatorAccessError) releaseOwnerSends(1);
      result = { email, outcome: "failed" };
    }
    if (result.outcome === "already" || result.outcome === "invalid") releaseOwnerSends(1);
    body.email = result;
  }
  return ownerJson(body, 201);
}
