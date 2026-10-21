import { createDraftService } from "@yugidraft/shared/services";
import { buildDraftResponse } from "@/../app/api/drafts/[slug]/helpers";
import { auditSpectateRead, readSpectateSeat, requireAdminSpectate, spectateJson } from "@/lib/admin-spectate";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await requireAdminSpectate("draft", slug); if (!actor.ok) return actor.response;
  const requested = readSpectateSeat(request);
  if (requested === "invalid") return spectateJson({ error: "Invalid seat" }, 400);
  const row = actor.db.prepare("select id from drafts where web_slug=? and guild_id=?").get(slug, actor.guildId) as { id: number } | undefined;
  if (!row) return spectateJson({ error: "Not found" }, 404);
  const roster = actor.db.prepare(`select p.id,p.user_id from draft_players dp join players p on p.id=dp.player_id
    where dp.draft_id=? and p.guild_id=? order by coalesce(dp.seat_index,1000),dp.joined_at,dp.rowid`).all(row.id, actor.guildId) as { id: number; user_id: number | null }[];
  const player = requested === null ? roster[0] : roster.find(p => p.id === requested);
  if (requested !== null && !player) return spectateJson({ error: "Invalid seat" }, 400);
  const pov = player?.id ?? null;
  try {
    const draft = await buildDraftResponse(slug, actor, { playerId: pov });
    const current = await requireAdminSpectate("draft", slug); if (!current.ok) return current.response;
    if (!draft || current.userId !== actor.userId || current.guildId !== actor.guildId) return spectateJson({ error: "Not found" }, 404);
    // Raw deck read avoids the normal saved-deck service's on-read legacy repair writes.
    const saved = player?.user_id ? actor.db.prepare("select deck_json from saved_decks where guild_id=? and owner_user_id=? and draft_id=?").get(actor.guildId, player.user_id, row.id) as { deck_json: string } | undefined : undefined;
    auditSpectateRead(actor, "draft", slug, pov);
    return spectateJson({ readOnly: true, pov, draft, picks: createDraftService(actor.db).picks(row.id).filter(p => p.playerId === pov), deck: saved ? JSON.parse(saved.deck_json) : null });
  } catch { return spectateJson({ error: "The draft view is unavailable" }, 503); }
}
