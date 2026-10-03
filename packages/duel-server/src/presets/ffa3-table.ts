import { chainWith, target } from "../scripted-bot.js";
import { onChain, type Preset } from "./types.js";

// Small deterministic boards for browser checks. No first-turn battle override:
// current engine blocks turns 1-3; ADR R-FFA-NO-ATTACK requires turn 3 (pending).
export const presets: Preset[] = [
  {
    id: "ffa3-table-battle",
    title: "Three-way targets and LP elimination",
    format: "ffa3",
    humanSeat: 0,
    needs: "multi-core",
    rules: ["R-FFA-ELIMINATION", "R-COMMON-EMZ"],
    board: {
      format: "ffa3",
      p0: { hand: ["Raigeki"], monsters: ["Blue-Eyes White Dragon", "Blue-Eyes White Dragon", "Blue-Eyes White Dragon"] },
      p1: { lp: 3000, hand: ["Sangan"], monsters: ["Celtic Guardian"], spells: [{ card: "Mind Crush", pos: "set" }], grave: ["Giant Rat"] },
      p2: { lp: 6000, hand: ["Sangan"], monsters: ["Celtic Guardian"] },
    },
    bots: { 1: [], 2: [] },
    checklist: [
      "Current engine: pass to turn 4 for Battle. ADR turn 3 is pending engine change.",
      "Attack a monster: targets from both rivals are offered.",
      "Current engine: Raigeki clears both rivals. This does not prove pending R-FFA-OPP-ONE.",
      "Three direct attacks eliminate seat 1 then seat 2; seat 0 wins with three distinct placings.",
    ],
  },
  {
    id: "ffa3-table-chain",
    title: "Three-way clockwise chain responses",
    format: "ffa3",
    humanSeat: 0,
    needs: "multi-core",
    rules: ["R-FFA-CHAIN"],
    board: {
      format: "ffa3",
      p0: { hand: ["Heavy Storm"], spells: ["Swords of Revealing Light", "Swords of Revealing Light", { card: "Mystical Space Typhoon", pos: "set" }] },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    bots: Object.fromEntries([1, 2].map((seat) => [seat, [
      chainWith("Dust Tornado", { if: onChain, note: `seat ${seat} responds clockwise` }),
      target({ card: "Swords of Revealing Light", owner: 0, nth: seat - 1 }),
    ]])),
    checklist: [
      "Activate Heavy Storm as chain link 1.",
      "Seat 1 responds with Dust Tornado before seat 2; decline the human response between them.",
      "After seat 2 responds, chain Mystical Space Typhoon and choose a rival's spell.",
      "The response resolves and Heavy Storm clears every remaining spell.",
    ],
  },
];
