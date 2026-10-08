import { NextResponse } from "next/server";
import { createDraftLobbyService, isTestBotDiscordId } from "@yugidraft/shared/services";
import { NUDGE_COOLDOWN_MS } from "@yugidraft/shared/types";
import { requireWebAccess } from "@/lib/web-access";
import { draftReadAccess } from "@/lib/draft-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { announcer } from "@/lib/notify";

export const runtime = "nodejs";

type DraftRow = {
  id: number; guild_id: string; channel_id: string | null; name: string; web_slug: string;
  status: string; created_by_user_id: number; lobby_nudged_at: string | null;
};
class NudgeError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryAfterSeconds?: number) { super(message); }
}
function fail(message: string, status: number, code: string): never { throw new NudgeError(message, status, code); }
function validDiscordId(id: string | null): id is string {
  return id !== null && /^[1-9]\d{16,19}$/.test(id) && BigInt(id) <= 18_446_744_073_709_551_615n;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Nudge posts through the Discord bot; with the bot shelved the route does not exist.
  if (!env.discordBotEnabled) return NextResponse.json({ error: "discord_disabled" }, { status: 404 });
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;
    const userId = actor.userId;
    if (!env.discordGuildId) fail("Server not configured", 503, "GUILD_ACCESS_UNAVAILABLE");
    const { slug } = await params;
    const db = getDb();
    const denied = draftReadAccess(db, slug, env.discordGuildId, userId);
    if (denied) return denied;
    let body: unknown;
    try { body = await request.json(); } catch { fail("Invalid JSON body", 400, "INVALID_BODY"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "playerId")) {
      fail("Expected an object with an optional playerId", 400, "INVALID_BODY");
    }
    const playerId = (body as { playerId?: unknown }).playerId;
    if (playerId !== undefined && (typeof playerId !== "number" || !Number.isSafeInteger(playerId) || playerId <= 0)) {
      fail("playerId must be a positive integer", 400, "INVALID_BODY");
    }
    const now = new Date();
    const reservedAt = now.toISOString();
    const reservation = db.transaction(() => {
      // Recheck ownership/status/guild and eligibility under the same write lock as the reservation.
      const draft = db.prepare("select * from drafts where web_slug = ? and guild_id = ?").get(slug, env.discordGuildId) as DraftRow | undefined;
      if (!draft) fail("Draft not found", 404, "DRAFT_NOT_FOUND");
      if (draft.created_by_user_id !== userId) fail("Only the draft host can Nudge", 403, "HOST_REQUIRED");
      if (draft.status !== "pending") fail("Draft is no longer pending", 409, "DRAFT_NOT_PENDING");
      if (!draft.channel_id) fail("Draft has no Discord channel", 400, "NUDGE_TARGET_INVALID");
      const state = createDraftLobbyService(db).read(draft.id, userId, now);
      const unready = new Set(state.players.filter(player => !player.ready && !player.isBot).map(player => player.playerId));
      const members = (db.prepare(`select p.id, u.discord_user_id from draft_players dp
        join players p on p.id = dp.player_id join users u on u.id = p.user_id where dp.draft_id = ? and p.guild_id = ?`).all(draft.id, draft.guild_id) as Array<{ id: number; discord_user_id: string | null }>)
        .filter(member => unready.has(member.id) && !isTestBotDiscordId(member.discord_user_id) && validDiscordId(member.discord_user_id));
      const targets = playerId === undefined ? members : members.filter(member => member.id === playerId);
      if (playerId !== undefined && targets.length === 0) fail("Choose a joined, unready human player", 400, "NUDGE_TARGET_INVALID");
      const nextAt = draft.lobby_nudged_at ? new Date(draft.lobby_nudged_at).getTime() + NUDGE_COOLDOWN_MS : 0;
      if (nextAt > now.getTime()) {
        throw new NudgeError("Nudge is on cooldown", 429, "NUDGE_COOLDOWN", Math.ceil((nextAt - now.getTime()) / 1000));
      }
      db.prepare("update drafts set lobby_nudged_at = ? where id = ?").run(reservedAt, draft.id);
      return { draft, mentionUserIds: [...new Set(targets.map(member => member.discord_user_id!))] };
    }).immediate();

    let delivered = false;
    try {
      const result = await announcer.announce({ kind: "draft-nudge", draftId: reservation.draft.id,
        channelId: reservation.draft.channel_id!, name: reservation.draft.name, webSlug: reservation.draft.web_slug,
        mentionUserIds: reservation.mentionUserIds });
      delivered = result.ok;
    } catch {
      // Treat rejected transports the same as an explicit failure result.
    }
    if (!delivered) {
      db.prepare("update drafts set lobby_nudged_at = null where id = ? and lobby_nudged_at = ?").run(reservation.draft.id, reservedAt);
      fail("Could not deliver Nudge to Discord. Please try again.", 502, "NUDGE_FAILED");
    }
    return NextResponse.json({ ok: true, channelId: reservation.draft.channel_id!,
      nextAllowedAt: new Date(now.getTime() + NUDGE_COOLDOWN_MS).toISOString() });
  } catch (error) {
    if (error instanceof NudgeError) {
      return NextResponse.json({ error: error.message, code: error.code,
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }, {
        status: error.status, ...(error.retryAfterSeconds !== undefined ? { headers: { "Retry-After": String(error.retryAfterSeconds) } } : {}),
      });
    }
    console.error("[api/drafts/[slug]/nudge] error:", error);
    return NextResponse.json({ error: "Failed to Nudge draft" }, { status: 500 });
  }
}
