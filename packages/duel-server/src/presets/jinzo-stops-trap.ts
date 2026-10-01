import { attackWith, choose } from "../scripted-bot.js";
import type { Preset } from "./types.js";

/**
 * 1v1. The bot plays turn 2 and attacks directly with Jinzo. The human's set Mirror Force cannot be activated, because
 * Jinzo stops every Trap. The human takes 2400 damage and gets no Trap prompt.
 */
export const preset: Preset = {
  id: "jinzo-stops-trap",
  title: "Jinzo stops a Trap",
  format: "1v1",
  humanSeat: 0,
  rules: ["R-COMMON-CONT-NEG"],
  board: {
    turn: "p1",
    p0: { spells: [{ card: "Mirror Force", pos: "set" }] },
    p1: { monsters: [{ card: "Jinzo", pos: "atk" }] },
  },
  bots: {
    1: [
      choose("to_bp", { note: "go to the Battle Phase to attack with Jinzo" }),
      attackWith("Jinzo", { note: "attack directly with Jinzo" }),
    ],
  },
  checklist: [
    "The bot plays first (turn 2). It goes to its Battle Phase and attacks you directly with Jinzo.",
    "You get no prompt to activate Mirror Force: Jinzo stops your Trap.",
    "Your LP goes from 8000 to 5600.",
    "Mirror Force is still set on your field.",
  ],
};
