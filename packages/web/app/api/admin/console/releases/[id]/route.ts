import { ownerReleaseMutation, releaseContext, releaseId, releaseJson, type ReleaseParams } from "@/lib/releases-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: ReleaseParams): Promise<Response> {
  return ownerReleaseMutation(request, true, async actor => {
    const { releases, outbox } = releaseContext(), release = releases.editDraft(await releaseId(context), actor.body);
    return releaseJson({ ...release, email: outbox.state(release.id) });
  });
}
