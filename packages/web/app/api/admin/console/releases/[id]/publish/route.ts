import { ownerReleaseMutation, releaseContext, releaseId, releaseJson, type ReleaseParams } from "@/lib/releases-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: ReleaseParams): Promise<Response> {
  return ownerReleaseMutation(request, true, async actor => {
    if (actor.body.autoEmail !== undefined && typeof actor.body.autoEmail !== "boolean") return releaseJson({ error: "invalid_auto_email" }, 400);
    const { releases, outbox } = releaseContext(), release = releases.publish(await releaseId(context), { actorUserId: actor.userId, autoEmail: actor.body.autoEmail as boolean | undefined });
    return releaseJson({ ...release, email: outbox.state(release.id) });
  });
}
