import type { Preset } from "./types.js";

export const preset: Preset = {
  id: "ffa3-mind-crush-pick",
  title: "Mind Crush picks one opponent (3 seats)",
  format: "ffa3",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-COMMON-OPP-PICK"],
  board: {
    format: "ffa3",
    p0: { spells: [{ card: "Mind Crush", pos: "set" }] },
    p1: { hand: ["Sangan"] },
    p2: { hand: ["Sangan"] },
  },
  bots: { 1: [], 2: [] },
  checklist: [
    "End the first turn. Your next draw on turn 4 opens a response window for the pre-set Trap.",
    "Activate Mind Crush and pick seat 2. Name Sangan.",
    "Only seat 2 discards Sangan; seat 1 keeps Sangan and has an empty Graveyard.",
  ],
};
