import { activate } from "../scripted-bot.js";
import type { Preset } from "./types.js";

/** 1v1. The human Normal Summons. The bot pays half its LP with Solemn Judgment to negate and destroy the summon. */
export const preset: Preset = {
  id: "solemn-judgment-summon",
  title: "Solemn Judgment on a Normal Summon",
  format: "1v1",
  humanSeat: 0,
  rules: ["R-FFA-NEGATE"],
  board: {
    p0: { hand: ["Celtic Guardian"] },
    p1: { spells: [{ card: "Solemn Judgment", pos: "set" }] },
  },
  bots: {
    1: [activate("Solemn Judgment", { note: "negate the Normal Summon of the opponent" })],
  },
  checklist: [
    "You start in your Main Phase 1 with Celtic Guardian in your hand.",
    "Normal Summon Celtic Guardian.",
    "The bot activates Solemn Judgment in response to the summon.",
    "The bot LP goes from 8000 to 4000 (half paid as the cost).",
    "Celtic Guardian is negated and destroyed: it is in your grave, not on the field.",
    "Solemn Judgment is in the bot grave.",
  ],
};
