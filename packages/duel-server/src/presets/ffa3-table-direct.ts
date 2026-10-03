import type { Preset } from "./types.js";

export const preset: Preset = {
  id: "ffa3-table-direct",
  title: "Three-way direct attacks and elimination",
  format: "ffa3",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-FFA-ATTACK", "R-FFA-ELIMINATION", "R-FFA-WINNER"],
  board: {
    format: "ffa3",
    p0: { monsters: ["Blue-Eyes White Dragon", "Blue-Eyes White Dragon", "Blue-Eyes White Dragon"] },
    p1: { lp: 3000, hand: ["Sangan"], spells: [{ card: "Mind Crush", pos: "set" }], grave: ["Giant Rat"] },
    p2: { lp: 6000, hand: ["Sangan"] },
  },
  bots: { 1: [], 2: [] },
  checklist: [
    "Pass to the human's second turn; opponents have no monsters.",
    "Attack seat 1 directly; its hand, set Trap and Graveyard leave the game at 0 LP.",
    "Reload and check that seat 1 is empty, out in third place, and skipped by turn order.",
    "Two more direct attacks defeat seat 2. Standings list seats 0, 2, 1.",
  ],
};
