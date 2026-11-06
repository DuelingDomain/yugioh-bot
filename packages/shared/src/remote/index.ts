export * from "./actions.js";
export * from "./match-contract.js";
export * from "./match.js";
export * from "./types.js";
export * from "./attack-resolver.js";
export * from "./phases.js";
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

export * from "./effect-filters.js";
export * from "./effect-tracking.js";
export * from "./privacy.js";

export * from "./undo.js";

export { REMOTE_TWIN_MOVE_WINDOW_MS, recentFieldDeparture } from "./twin-placement.js";

export * from "./hand.js";
export * from "./search-candidates.js";
