import type { DuelRoom } from "@yugidraft/shared/duels";
import type { DuelActor } from "./duel-host";

/** Best-effort heartbeat; room reads and socket credentials remain available during write contention. */
export function renewWaitingTable(actor: Extract<DuelActor, { ok: true }>, room: DuelRoom) {
  if (room.session.status !== "lobby" || room.session.organizerPlayerId !== actor.playerId || room.opening != null) return;
  try { actor.duels.touchWaiting(room.session.slug, actor.guildId, actor.playerId); }
  catch { /* A later room read or socket renewal can retry. */ }
}
