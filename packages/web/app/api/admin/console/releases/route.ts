import { ownerReleaseRead, ownerReleaseMutation, releaseContext, releaseJson } from "@/lib/releases-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  return ownerReleaseRead(() => {
    const { releases, outbox, missingConfig } = releaseContext();
    return releaseJson({ releases: releases.listAdmin().map(release => ({ ...release, email: outbox.state(release.id) })), emailConfigured: missingConfig.length === 0, missingConfig });
  });
}
export async function POST(request: Request): Promise<Response> {
  return ownerReleaseMutation(request, true, actor => {
    const { releases, outbox } = releaseContext(), release = releases.createDraft(actor.body);
    return releaseJson({ ...release, email: outbox.state(release.id) }, 201);
  });
}
