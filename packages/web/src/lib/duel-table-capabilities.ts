import { multiplayerTablesEnabled, type DuelTableCapabilities } from "@yugidraft/shared/duels";
import { env } from "./env";
import { callDuelHost, requireDuelActor } from "./duel-host";

// Existing server callers use the same flag reader as the host and shared helpers.
export { multiplayerTablesEnabled } from "@yugidraft/shared/duels";

/** Unknown host status keeps multiplayer options closed. 1v1 needs no host query. */
export async function duelCreatorCapabilities(): Promise<DuelTableCapabilities & { discordEnabled: boolean }> {
  const closed = { discordEnabled: env.discordBotEnabled, multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: false };
  if (!multiplayerTablesEnabled()) return closed;
  const actor = await requireDuelActor();
  if (!actor.ok) return closed;
  const result = await callDuelHost({ op: "capabilities", guildId: actor.guildId, playerId: actor.playerId });
  if (!result.ok) return closed;
  const data = result.data as Partial<DuelTableCapabilities> | null;
  return { discordEnabled: env.discordBotEnabled, multiplayerTables: data?.multiplayerTables === true, multiCoreReady: data?.multiCoreReady === true, multiDomainCoreReady: data?.multiDomainCoreReady === true };
}
