import { ownerReleaseMutation, releaseContext, releaseId, releaseJson, type ReleaseParams } from "@/lib/releases-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: ReleaseParams): Promise<Response> {
  return ownerReleaseMutation(request, true, async actor => {
    if (typeof actor.body.token !== "string" || actor.body.token.length > 200) return releaseJson({ error: "invalid_token" }, 400);
    return releaseJson(await releaseContext().outbox.confirm(await releaseId(context), actor.userId, actor.body.token));
  });
}
