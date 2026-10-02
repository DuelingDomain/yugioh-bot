import { multiplayerTablesEnabled, type DuelTableCapabilities } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "./duel-host";

// Existing server callers use the same flag reader as the host and shared helpers.
export { multiplayerTablesEnabled } from "@yugidraft/shared/duels";

/** Unknown host status keeps multiplayer options closed. 1v1 needs no host query. */
export async function duelCreatorCapabilities(): Promise<DuelTableCapabilities> {
  const closed = { multiplayerTables: false, multiDomainCoreReady: false };
  if (!multiplayerTablesEnabled()) return closed;
  const actor = await requireDuelActor();
  if (!actor.ok) return closed;
  const result = await callDuelHost({ op: "capabilities", guildId: actor.guildId, playerId: actor.playerId });
  if (!result.ok) return closed;
  const data = result.data as Partial<DuelTableCapabilities> | null;
  return { multiplayerTables: data?.multiplayerTables === true, multiDomainCoreReady: data?.multiDomainCoreReady === true };
}
