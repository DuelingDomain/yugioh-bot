import { NextResponse } from "next/server";
import { httpTransport } from "@yugidraft/shared/notify";
import { createDuelService, createPlayerService, DuelServiceError, type DuelService } from "@yugidraft/shared/services";
import type { DuelCommand, DuelDeck } from "@yugidraft/shared/duels";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyDiscordGuildMembership } from "@/lib/discord-guild-membership";

export type DuelHostOp = "view" | "start" | "respond" | "deck" | "cards" | "surrender" | "add-bot" | "archive" | "cancel";

type DuelActor =
  | { ok: true; guildId: string; playerId: number; duels: DuelService }
  | { ok: false; response: NextResponse };

export async function requireDuelActor(): Promise<DuelActor> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const guildId = env.discordGuildId;
  if (!guildId) {
    return { ok: false, response: NextResponse.json({ error: "Guild is not configured" }, { status: 500 }) };
  }
  const membership = await verifyDiscordGuildMembership({
    guildId,
    userId: session.user.id,
    botToken: process.env.DISCORD_TOKEN ?? "",
  });
  if (!membership.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: membership.status === 403 ? "Forbidden" : "Guild membership is unavailable" },
        { status: membership.status },
      ),
    };
  }
  const db = getDb();
  const player = createPlayerService(db).findOrCreate(guildId, session.user.id, session.user.name ?? "Unknown");
  return { ok: true, guildId, playerId: player.id, duels: createDuelService(db) };
}

export function duelErrorResponse(error: unknown) {
  if (error instanceof DuelServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[api/duels]", error);
  return NextResponse.json({ error: "Failed to process duel request" }, { status: 500 });
}

function hostErrorMessage(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Host may return a plain-text error body.
  }
  return text.trim() || "Duel engine error";
}

export async function callDuelHost(input: {
  op: DuelHostOp;
  slug?: string;
  guildId: string;
  playerId: number;
  command?: DuelCommand;
  deck?: DuelDeck;
  query?: string;
}): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  const transport = httpTransport({ url: env.duelInternalUrl, secret: env.duelInternalSecret });
  const payload: Record<string, unknown> = {
    op: input.op,
    guildId: input.guildId,
    playerId: input.playerId,
  };
  if (input.slug) payload.slug = input.slug;
  if (input.command) payload.command = input.command;
  if (input.deck) payload.deck = input.deck;
  if (input.query !== undefined) payload.query = input.query;

  const result = await transport.post("/internal/duel", JSON.stringify(payload));
  if (!result.ok) {
    const status = result.status >= 400 ? result.status : 503;
    return {
      ok: false,
      response: NextResponse.json({ error: hostErrorMessage(result.text || "Duel engine is unavailable") }, { status }),
    };
  }
  if (!result.text) {
    return { ok: false, response: NextResponse.json({ error: "Empty engine response" }, { status: 502 }) };
  }
  try {
    return { ok: true, data: JSON.parse(result.text) as unknown };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid engine response" }, { status: 502 }) };
  }
}

export function sessionFromHost(data: unknown) {
  if (data && typeof data === "object" && "session" in data) {
    return { session: data.session };
  }
  return { session: data };
}
