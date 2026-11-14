// Test recording of the player's own table camera, for allowlisted users only (REMOTE_RECORD_USERS). Off (404) when the
// variable is unset. Only a seated player can record, and only their own seat. See docs/remote-duels/test-recording.md.
import { isRemoteRecordUser } from "@yugidraft/shared/access/remote-record-users";
import { remoteAssert } from "@yugidraft/shared/remote";
import { appendChunk, clockRecording, endRecording, noteCalibration, precheckChunk, readChunkBytes, startRecording } from "@/lib/remote/recordings-server";
import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { readSmallJsonObject } from "@/lib/read-small-body";
export const runtime = "nodejs";

async function guard(context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor;
  if (!isRemoteRecordUser(actor.userId)) return { ok: false as const, response: remoteJson({ error: "Not found" }, 404) };
  const { slug } = await context.params;
  const access = actor.remote.connectionAccess(slug, actor.guildId, actor.userId);
  remoteAssert(access.seat !== null, "Only a seated player can record", 403, "REMOTE_RECORD_SEAT");
  return { ok: true as const, userId: actor.userId, slug: access.slug, seat: access.seat };
}

/**
 * POST ?action=start|end|calibration with a JSON body, ?action=clock&id= (no body: answers with the server time, for the clock sample of the next chunk),
 * or ?id=<recording>&n=<chunk number> with the raw video bytes.
 */
export async function POST(request: Request, context: RemoteRouteContext) {
  try {
    const who = await guard(context); if (!who.ok) return who.response;
    const params = new URL(request.url).searchParams, id = params.get("id"), action = params.get("action");
    if (action === "clock") { remoteAssert(id, "Missing recording id"); const body=request.body?await readSmallJsonObject(request,12288):null;return remoteJson(await clockRecording({ id, userId: who.userId, seat: who.seat, slug: who.slug,setCandidates:body?.setCandidates })); }
    if (action === "start" || action === "end" || action === "calibration") {
      const body = await readSmallJsonObject(request, 12288); remoteAssert(body, "Invalid JSON object");
      if (action === "start") return remoteJson(await startRecording({ userId: who.userId, slug: who.slug, seat: who.seat, userAgent: request.headers.get("user-agent"), body }));
      remoteAssert(id, "Missing recording id");
      if (action === "calibration") return remoteJson(await noteCalibration({ id, userId: who.userId, seat: who.seat, slug: who.slug, body }));
      return remoteJson(await endRecording({ id, userId: who.userId, seat: who.seat, slug: who.slug, body }));
    }
    remoteAssert(id && /^\d{1,9}$/.test(params.get("n") ?? ""), "Missing recording id or chunk number");
    const seq = Number(params.get("n")), identity = { id, userId: who.userId, seat: who.seat, slug: who.slug, seq };
    // A repeat or a chunk without its header is refused before the body is read, so no upload is wasted.
    if (precheckChunk(identity) === "duplicate") return remoteJson({ ok: true, duplicate: true });
    const bytes = await readChunkBytes(request);
    const num = (key: string) => { const value = params.has(key) ? Number(params.get(key)) : NaN; return Number.isFinite(value) ? value : undefined; };
    return remoteJson(await appendChunk({ ...identity, bytes, clockOffsetMs: num("offset"), rttMs: num("rtt"), startDateNow: num("startDateNow"), startPerfNow: num("startPerfNow") }));
  } catch (error) { return remoteError(error); }
}
