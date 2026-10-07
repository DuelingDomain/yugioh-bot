import { NextResponse } from "next/server";
import { SandboxBoardError } from "@yugidraft/shared/duels";
import { createDuelService, createPlayerService, createSandboxScenarioService, SandboxScenarioServiceError } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { duelErrorResponse } from "@/lib/duel-host";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { checkDiscordWebAccess, webAccessError } from "@/lib/discord-web-access";

/** single swap point for a future role system. No environment or guild-admin bypass. */
export async function canUseSandbox(discordUserId: string | null | undefined): Promise<
  { ok: true } | { ok: false; status: 401 | 403 | 503 }
> {
  if (!discordUserId) return { ok: false, status: 401 };
  const allowed = (process.env.SANDBOX_DISCORD_IDS ?? "").split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9]{17,20}$/.test(id));
  if (!allowed.includes(discordUserId)) return { ok: false, status: 403 };
  return checkDiscordWebAccess(discordUserId, "member");
}

export async function requireSandboxActor() {
  const session = await auth();
  const access = await canUseSandbox(session?.user?.id);
  if (!access.ok) {
    return { ok: false as const, response: NextResponse.json(
      { error: access.status === 401 ? "Unauthorized" : webAccessError(access.status) },
      { status: access.status },
    ) };
  }
  const db = getDb();
  const guildId = env.discordGuildId;
  const player = createPlayerService(db).findOrCreate(guildId, session!.user!.id!, session!.user!.name ?? "Unknown");
  return {
    ok: true as const, guildId, playerId: player.id,
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
