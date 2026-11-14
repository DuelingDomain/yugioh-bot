import { voiceBatchSchema } from "@/lib/remote/voice-diagnostics-schema";
import { RemoteDuelError } from "@yugidraft/shared/remote";
import { remoteError, remoteJson, remoteVoiceDiagnosticsEnabledFor, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { readSmallBody } from "@/lib/read-small-body";
import { VOICE_BATCH_MAX_BYTES } from "@/lib/remote/voice-diagnostics";
import { allowVoiceDiagnostics, appendVoiceDiagnostics } from "@/lib/remote/voice-diagnostics-server";
export const runtime = "nodejs";

export async function POST(request: Request, context: RemoteRouteContext) {
  try {
    const actor = await requireRemoteActor();
    if (!actor.ok || !remoteVoiceDiagnosticsEnabledFor(actor.userId)) return remoteJson({ error: "Not found" }, 404);
    const { slug } = await context.params;
    let seat: number | null;
    try { seat = actor.remote.connectionAccess(slug, actor.guildId, actor.userId).seat; }
    catch (error) { if (error instanceof RemoteDuelError) return remoteJson({ error: "Not found" }, 404); throw error; }
    if (seat === null) return remoteJson({ error: "Not found" }, 404);
    if (!allowVoiceDiagnostics(actor.userId)) return remoteJson({ error: "Too many requests" }, 429);
    let raw: unknown;
    try { raw = JSON.parse(await readSmallBody(request, VOICE_BATCH_MAX_BYTES)); }
    catch (error) { return remoteJson({ error: "Invalid diagnostics body" }, error instanceof Error && error.message === "body_too_large" ? 413 : 400); }
    const body = voiceBatchSchema.safeParse(raw);
    if (!body.success) return remoteJson({ error: "Invalid diagnostics records" }, 400);
    try { await appendVoiceDiagnostics({ slug, userId: actor.userId, seat, records: body.data.records }); }
    catch (error) { if (error instanceof RemoteDuelError) return remoteError(error); return remoteJson({ error: "Diagnostics unavailable" }, 503); }
    return remoteJson({ ok: true });
  } catch (error) { return remoteError(error); }
}
