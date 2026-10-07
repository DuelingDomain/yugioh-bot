import type { Preset } from "./types.js";

export const preset: Preset = {
  id: "ffa4-rules-across-extra-zones",
  title: "The facing partner blocks the matching EMZ",
  format: "ffa4", humanSeat: 0, needs: "multi-core",
  rules: ["R-FFA-ACROSS-EMZ"],
  board: {
    format: "ffa4",
    p0: { monsters: ["Mystical Elf"], extra: ["Link Spider"] },
    // Seat 1 sequence 6 facing seat 0 mirrors to its sequence 5.
    p1: { monsters: [null, null, null, null, null, null, "Link Spider"] },
  },
  bots: { 1: [], 2: [], 3: [] },
  checklist: [
    "Link Summon Spider from the real Extra Deck using your Elf.",
    "ADR: seat 1's right EMZ blocks seat 0's left EMZ, so Spider lands in the right EMZ.",
    "Seats 2 and 3 share their own EMZ row and do not block yours.",
  ],
};
