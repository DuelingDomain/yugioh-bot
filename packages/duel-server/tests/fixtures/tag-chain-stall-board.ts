import type { BoardSpec } from "../support/board.js";

// Liberator can target the partner's Metaion. Metaion cannot be destroyed,
// so the optional effect can be used again after each chain ends.
export const TAG_CHAIN_STALL_BOARD: BoardSpec = {
  format: "tag",
  mode: "domain",
  deckSize: 20,
  p0: { grave: ["Borreload Liberator Dragon"], deckMaster: "Blue-Eyes White Dragon" },
  p1: { deckMaster: "Blue-Eyes White Dragon" },
  p2: { monsters: ["Metaion, the Timelord"], deckMaster: "Blue-Eyes White Dragon" },
  p3: { deckMaster: "Blue-Eyes White Dragon" },
};
