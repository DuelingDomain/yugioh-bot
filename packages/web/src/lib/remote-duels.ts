import { NextResponse } from "next/server";
import { createRemoteDuelService } from "@yugidraft/shared/services";
import { remoteActionSchema, remoteAssert, RemoteDuelError, type SeatCount } from "@yugidraft/shared/remote";
import { signedTransport } from "@yugidraft/shared/internal-auth";
import { errorResponseBody, log } from "@yugidraft/shared/observability";
import { requireWebAccess } from "./web-access";
import { getDb } from "./db";
import { readSmallJsonObject } from "./read-small-body";

export const remoteDuelsEnabled = () => process.env.REMOTE_DUELS === "1";
export function remoteJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "private, no-store" } });
}
export async function requireRemoteActor() {
  if (!remoteDuelsEnabled()) return { ok: false as const, response: remoteJson({ error: "Not found" }, 404) };
  const access = await requireWebAccess();
  if (!access.ok) { access.response.headers.set("cache-control", "private, no-store"); return access; }
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return { ok: false as const, response: remoteJson({ error: "Guild is not configured" }, 500) };
  return { ok: true as const, userId: access.userId, displayName: access.userName, guildId, remote: createRemoteDuelService(getDb()) };
}
export function remoteError(error: unknown) {
  if (error instanceof RemoteDuelError) return remoteJson({ error: error.message, code: error.code }, error.status);
  const { body, status } = errorResponseBody(error, { tags: { operation: "remote-api" } });
  return remoteJson(body, status);
}
export async function remoteBody(request: Request, keys: string[]) {
  const body = await readSmallJsonObject(request, 8192);
  remoteAssert(body && Object.keys(body).every(key => keys.includes(key)), "Invalid JSON object or unexpected fields");
  return body;
}
/** Commit first; publish only a signed guild/slug reference, never client-supplied state. */
export async function notifyRemoteChange(slug: string, guildId: string) {
  const url = process.env.WS_INTERNAL_URL; const secret = process.env.WS_INTERNAL_SECRET;
  if (!url || !secret) return;
  const result = await signedTransport({ url, secret, purpose: "ws-broadcast", timeoutMs: 2000 })
    .post("/internal/remote/changed", JSON.stringify({ slug, guildId }));
  if (!result.ok) log("warn", "Remote broadcast unavailable", { status: result.status });
}
export type RemoteRouteContext = { params: Promise<{ slug: string }> };
export async function remoteMutation(request: Request, context: RemoteRouteContext, operation: "seat" | "leave" | "ready" | "start" | "actions") {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    const keys = { seat: ["seat"], leave: [], ready: ["ready"], start: [], actions: ["baseSeq", "action"] };
    // Empty bodies are accepted for the two bodyless operations.
    const body = operation === "leave" || operation === "start" ? {} : await remoteBody(request, keys[operation]);
    let result;
    switch (operation) {
      case "seat":
        remoteAssert(body.seat === undefined || (typeof body.seat === "number" && Number.isInteger(body.seat) && body.seat >= 0 && body.seat <= 3), "Invalid seat");
        result = actor.remote.join(slug, actor.guildId, actor.userId, actor.displayName, body.seat as number | undefined); break;
      case "leave": result = actor.remote.leave(slug, actor.guildId, actor.userId); break;
      case "ready": remoteAssert(typeof body.ready === "boolean", "Invalid readiness");
        result = actor.remote.ready(slug, actor.guildId, actor.userId, body.ready); break;
      case "start": result = actor.remote.start(slug, actor.guildId, actor.userId); break;
      case "actions": {
        const action = remoteActionSchema.safeParse(body.action); remoteAssert(action.success, "Invalid action");
        remoteAssert(typeof body.baseSeq === "number" && Number.isSafeInteger(body.baseSeq) && body.baseSeq >= 0, "Invalid base sequence");
        result = actor.remote.act(slug, actor.guildId, actor.userId, { baseSeq: body.baseSeq, action: action.data }); break;
      }
    }
    await notifyRemoteChange(slug, actor.guildId);
    return remoteJson(result);
  } catch (error) { return remoteError(error); }
}
export function remoteSeatCount(value: unknown): SeatCount {
  remoteAssert(value === 2 || value === 3 || value === 4, "Seat count must be 2, 3 or 4"); return value;
}
