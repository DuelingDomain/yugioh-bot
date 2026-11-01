import { NextResponse } from "next/server";
import { SandboxBoardError, seatCountFor, type DuelRoom } from "@yugidraft/shared/duels";
import { createDuelService, createPlayerService, createSandboxScenarioService, SandboxScenarioServiceError } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { duelErrorResponse, readDuelControl } from "@/lib/duel-host";
import { requireWebAccess } from "@/lib/web-access";
import { env } from "@/lib/env";

/** single swap point for a future role system. No environment or guild-admin bypass. */
export async function canUseSandbox(discordUserId: string | null | undefined): Promise<
  { ok: true } | { ok: false; status: 401 | 403 | 503 }
> {
  if (!discordUserId) return { ok: false, status: 401 };
  const allowed = (process.env.SANDBOX_DISCORD_IDS ?? "").split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9]{17,20}$/.test(id));
  if (!allowed.includes(discordUserId)) return { ok: false, status: 403 };
  return { ok: true };
}

export async function requireSandboxActor() {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor;
  const access = await canUseSandbox(actor.discordUserId);
  if (!access.ok) {
    return { ok: false as const, response: NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: access.status, headers: { "cache-control": "private, no-store" } },
    ) };
  }
  const db = getDb();
  const guildId = env.discordGuildId;
  if (!guildId) return { ok: false as const, response: NextResponse.json({ error: "Guild is not configured" }, { status: 500 }) };
  const player = createPlayerService(db).findOrCreate(guildId, actor.userId, actor.userName);
  return {
    ok: true as const, guildId, playerId: player.id, userId: actor.userId,
    duels: createDuelService(db), scenarios: createSandboxScenarioService(db),
  };
}

export class SandboxRequestError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "SandboxRequestError";
  }
}

export function sandboxErrorResponse(error: unknown) {
  if (error instanceof SandboxBoardError) {
    return NextResponse.json({ error: error.message, path: error.path }, { status: 400 });
  }
  if (error instanceof SandboxScenarioServiceError || error instanceof SandboxRequestError) {
    return NextResponse.json({
      error: error.message,
      ...(error instanceof SandboxScenarioServiceError && error.path ? { path: error.path } : {}),
    }, { status: error.status });
  }
  return duelErrorResponse(error);
}

const MAX_BODY_BYTES = 64 * 1024;

/** Bound the stream itself; Content-Length may be absent or incorrect. */
export async function readSandboxBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new SandboxRequestError("Request body must not exceed 64 KiB", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SandboxRequestError("Invalid JSON body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new SandboxRequestError("Request body must not exceed 64 KiB", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SandboxRequestError("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SandboxRequestError("Expected a JSON object");
  }
  return body as Record<string, unknown>;
}

export function parseSandboxId(raw: unknown): number {
  const value = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new SandboxRequestError("Scenario id must be a positive integer");
  }
  return value;
}

export function hasSandboxQuery(request: Request): boolean {
  const query = new URL(request.url).searchParams;
  return query.has("as") || query.has("reveal");
}

/** Query options are used by both view and actions. Keep false and seat zero. */
export function sandboxQueryOptions(request: Request): { as?: number; reveal?: boolean } {
  const query = new URL(request.url).searchParams;
  for (const key of ["as", "reveal"]) {
    if (query.getAll(key).length > 1) throw new SandboxRequestError(`Duplicate ${key} option`);
  }
  const input: Record<string, unknown> = {};
  if (query.has("as")) {
    const raw = query.get("as")!;
    if (!/^[0-3]$/.test(raw)) throw new SandboxRequestError("as must be a seat from 0 to 3");
    input.as = Number(raw);
  }
  if (query.has("reveal")) {
    const raw = query.get("reveal");
    if (!["true", "false", "1", "0"].includes(raw!)) throw new SandboxRequestError("reveal must be true or false");
    input.reveal = raw === "true" || raw === "1";
  }
  return sandboxBodyOptions(input);
}

/** Resolve the room kind before checking controls: fork owner access and sandbox allowlisting are independent. */
export async function authorizeDuelControl(request: Request, room: DuelRoom | undefined, allowed: "view" | "action" | "cards" | "none" = "none") {
  if (!room?.session.sandbox) return { ok: true as const, control: readDuelControl(request, room, allowed) };
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor;
  const options = sandboxQueryOptions(request);
  const query = new URL(request.url).searchParams;
  if (query.has("promptId") || query.has("revision") || (allowed === "none" && hasSandboxQuery(request))) {
    throw new SandboxRequestError("Invalid sandbox control request");
  }
  if (options.as !== undefined && options.as >= seatCountFor(room.session.format)) {
    throw new SandboxRequestError("Invalid sandbox seat");
  }
  return { ok: true as const, control: options };
}

export function sandboxBodyOptions(body: Record<string, unknown>): { as?: number; reveal?: boolean } {
  const options: { as?: number; reveal?: boolean } = {};
  if (body.as !== undefined) {
    if (typeof body.as !== "number" || !Number.isInteger(body.as) || body.as < 0 || body.as > 3) {
      throw new SandboxRequestError("as must be a seat from 0 to 3");
    }
    options.as = body.as;
  }
  if (body.reveal !== undefined) {
    if (typeof body.reveal !== "boolean") throw new SandboxRequestError("reveal must be true or false");
    options.reveal = body.reveal;
  }
  return options;
}
