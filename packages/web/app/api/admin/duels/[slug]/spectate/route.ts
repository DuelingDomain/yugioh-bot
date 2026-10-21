import { seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { callDuelHost } from "@/lib/duel-host";
import { readSpectateSeat, requireAdminSpectate, spectateJson } from "@/lib/admin-spectate";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await requireAdminSpectate("duel", slug); if (!actor.ok) return actor.response;
  const seat = readSpectateSeat(request);
  const row = actor.db.prepare("select format from duels where web_slug=? and guild_id=?").get(slug, actor.guildId) as { format: DuelFormat };
  if (seat === "invalid" || (seat !== null && seat >= seatCountFor(row.format))) return spectateJson({ error: "Invalid seat" }, 400);
  const result = await callDuelHost({ op: "admin-spectate", slug, guildId: actor.guildId, userId: actor.userId, seat });
  const current = await requireAdminSpectate("duel", slug); if (!current.ok) return current.response;
  if (current.userId !== actor.userId || current.guildId !== actor.guildId) return spectateJson({ error: "Not found" }, 404);
  if (!result.ok) { result.response.headers.set("Cache-Control", "private, no-store"); return result.response; }
  return spectateJson({ readOnly: true, pov: seat, room: result.data });
}
