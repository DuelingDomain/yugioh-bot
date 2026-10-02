import type { Preset } from "./types.js";

export const preset: Preset = {
  id: "ffa3-turn-player-last",
  title: "Turn player responds last after both rivals pass",
  format: "ffa3",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-FFA-CHAIN"],
  board: {
    format: "ffa3",
    p0: { hand: ["Heavy Storm", "Mystical Space Typhoon"], spells: ["Swords of Revealing Light"] },
    p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
  },
  bots: { 1: [], 2: [] },
  checklist: [
    "Activate Heavy Storm as the turn player, after declining empty-chain windows.",
    "Both rivals pass. The human receives the last response window; the chain remains open.",
    "Pass the human response. Only then does Heavy Storm destroy every spell.",
  ],
};
