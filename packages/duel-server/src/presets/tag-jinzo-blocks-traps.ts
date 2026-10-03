import type { Preset } from "./types.js";

/** Tag. Jinzo negates every Trap at the table, the partner's too (R-COMMON-CONT-NEG). */
export const preset: Preset = {
  id: "tag-jinzo-blocks-traps",
  title: "Tag: Jinzo stops all Traps",
  format: "tag",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-COMMON-CONT-NEG"],
  board: {
    format: "tag",
    p0: { hand: ["Celtic Guardian"], monsters: [{ card: "Jinzo", pos: "atk" }], spells: [{ card: "Mirror Force", pos: "set" }] },
    p1: { spells: [{ card: "Solemn Judgment", pos: "set" }] },
    p2: { spells: [{ card: "Torrential Tribute", pos: "set" }] },
    p3: { spells: [{ card: "Trap Hole", pos: "set" }] },
  },
  bots: { 1: [], 2: [], 3: [] },
  checklist: [
    "You control Jinzo. Your own Mirror Force, the Torrential Tribute of your partner and the Traps of both opponents are set.",
    "Normal Summon Celtic Guardian.",
    "No seat gets a prompt to activate a Trap: not the opponents, not your partner, not you.",
    "Celtic Guardian stays on the field.",
  ],
};
