import { ownerReleaseMutation, releaseClerk, releaseContext, releaseId, releaseJson, type ReleaseParams } from "@/lib/releases-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: ReleaseParams): Promise<Response> {
  return ownerReleaseMutation(request, false, async actor => {
    const { outbox } = releaseContext();
    return releaseJson(await outbox.preview(await releaseId(context), actor.userId, releaseClerk()));
  });
}
