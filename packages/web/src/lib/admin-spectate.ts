import { NextResponse } from "next/server";
import { isOwnerUser } from "@/lib/owner-access";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { canAdminSpectate, isAdminSpectateParticipant } from "@yugidraft/shared/services";
import { ADMIN_SPECTATE_TTL_MS, createAdminSpectateToken } from "@yugidraft/shared/ws";
import { recordModAction } from "@yugidraft/shared/discord-admin";

export const spectateJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function requireAdminSpectate(kind: "duel" | "draft", slug: string) {
  const actor = await requireWebAccess();
  if (!actor.ok) { actor.response.headers.set("Cache-Control", "private, no-store"); return actor; }
  if (!isOwnerUser(actor.userId)) return { ok: false as const, response: spectateJson({ error: "Not found" }, 404) };
  const guildId = env.discordGuildId;
  try {
    const db = getDb();
    const target = { kind, slug, guildId, userId: actor.userId };
    if (!canAdminSpectate(db, target)) {
      const participant = isAdminSpectateParticipant(db, target);
      return { ok: false as const, response: spectateJson(participant
        ? { error: "Admin watch is unavailable while you are a player or invitee in this live game. Open the player view instead.", code: "ADMIN_SPECTATE_PARTICIPANT" }
        : { error: "Not found" }, 404) };
    }
    return { ...actor, db, guildId };
  } catch { return { ok: false as const, response: spectateJson({ error: "Spectating is unavailable" }, 503) }; }
}
/** Strict single value; draft seats use player IDs, duel seats use engine indices. */
export function readSpectateSeat(request: Request): number | null | "invalid" {
  const q = new URL(request.url).searchParams;
  if (q.getAll("seat").length > 1) return "invalid";
  const value = q.get("seat");
  if (value === null || value === "public") return null;
  if (!/^(0|[1-9]\d*)$/.test(value)) return "invalid";
  const seat = Number(value); return Number.isSafeInteger(seat) ? seat : "invalid";
}
export function spectateConnection(kind: "duel" | "draft") {
  return async (_request: Request, { params }: { params: Promise<{ slug: string }> }) => {
    const { slug } = await params;
    const actor = await requireAdminSpectate(kind, slug); if (!actor.ok) return actor.response;
    if (!env.wsInternalSecret) return spectateJson({ error: "The live feed is unavailable" }, 503);
    const claims = { kind, slug, guildId: actor.guildId, userId: actor.userId, role: "admin-spectator" as const, expiresAt: Date.now() + ADMIN_SPECTATE_TTL_MS };
    return spectateJson({ token: createAdminSpectateToken(claims, env.wsInternalSecret), expiresAt: claims.expiresAt });
  };
}

/** Audit successful hidden POV reads, deduped across processes for five minutes. Never log cards. */
export function auditSpectateRead(actor: { db: ReturnType<typeof getDb>; guildId: string; userId: number },
  kind: "duel" | "draft", slug: string, pov: number | null) {
  if (pov === null) return;
  const params = kind === "duel" ? { kind, slug, seat: pov } : { kind, slug, playerId: pov };
  actor.db.transaction(() => {
    const recent = actor.db.prepare(`select 1 from mod_actions where guild_id=? and actor_user_id=?
      and action='admin_spectate' and result='success' and created_at>=? and params_json=? limit 1`)
      .get(actor.guildId, actor.userId, Date.now() - 5 * 60_000, JSON.stringify(params));
    if (!recent) recordModAction(actor.db, { guildId: actor.guildId, actorSiteUserId: actor.userId,
      action: "admin_spectate", params, result: "success", notifyDiscord: false });
  }).immediate();
}
