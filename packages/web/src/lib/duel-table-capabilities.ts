import type { DuelTableCapabilities } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "./duel-host";

/** Only the exact value 1 enables multiplayer tables. Read this on the server. */
export function multiplayerTablesEnabled(): boolean {
  return process.env.MULTIPLAYER_TABLES === "1";
}

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
