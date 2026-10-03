import { chainWith } from "../scripted-bot.js";
import type { Preset } from "./types.js";

export const preset: Preset = {
  id: "ffa3-third-response",
  title: "Third duelist responds with Mirror Force to an attack on another rival",
  format: "ffa3",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-FFA-OPP-RESPONSE"],
  board: {
    format: "ffa3",
    p0: { monsters: ["Blue-Eyes White Dragon"] },
    p1: { monsters: ["Celtic Guardian"] },
    p2: { monsters: ["Celtic Guardian"], spells: [{ card: "Mirror Force", pos: "set" }] },
  },
  bots: { 1: [], 2: [chainWith("Mirror Force")] },
  checklist: [
    "Pass to the human's second turn, then attack seat 1's Celtic Guardian.",
    "Seat 2 may activate Mirror Force although seat 1 was attacked.",
    "ADR expectation (pending engine change): only seat 0's monsters are destroyed; seat 1's monster stays.",
  ],
};
