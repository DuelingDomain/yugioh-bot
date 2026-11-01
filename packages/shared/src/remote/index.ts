export * from "./actions.js";
export * from "./types.js";
export * from "./attack-resolver.js";
export * from "./games/ygo.js";
import { ygoModule } from "./games/ygo.js";
import { remoteAssert } from "./actions.js";
import type { GameModule } from "./types.js";
export const remoteGames: readonly GameModule[] = [ygoModule];
export function getRemoteGame(id: string): GameModule {
  const game = remoteGames.find(game => game.id === id);
  remoteAssert(game, "Unsupported game"); return game;
}

export * from "./realtime.js";

export * from "./deck-checks.js";
export * from "./live-deck-checks.js";
