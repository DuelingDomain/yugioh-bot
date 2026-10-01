import { activate } from "../scripted-bot.js";
import type { Preset } from "./types.js";

/**
 * Tag. One LP total per team (16000). The human's partner (seat 2) holds a set Solemn Judgment, but it may not negate the
 * summon of its own partner (R-TAG-PARTNER). The opposing bot (seat 1) may, and pays half of ITS TEAM LP.
 */
export const preset: Preset = {
  id: "tag-lp-solemn-partner",
  title: "Tag: team LP and Solemn Judgment on a partner summon",
  format: "tag",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-TAG-LP", "R-TAG-PARTNER", "R-FFA-NEGATE"],
  board: {
    format: "tag",
    p0: { hand: ["Celtic Guardian"] },
    p1: { spells: [{ card: "Solemn Judgment", pos: "set" }] },
    p2: { spells: [{ card: "Solemn Judgment", pos: "set" }] },
  },
  bots: {
    1: [activate("Solemn Judgment", { note: "negate the summon of the opposing team" })],
    2: [activate("Solemn Judgment", { note: "must never fire: the summon is from my partner" })],
    3: [],
  },
  checklist: [
    "At the start every seat shows 16000 LP (the LP of a team is one shared value).",
    "Normal Summon Celtic Guardian.",
    "Seat 2 (your partner) is NOT asked to use its Solemn Judgment. No prompt for seat 2 offers it.",
    "Seat 1 activates Solemn Judgment. The LP of the opposing team (seats 1 and 3) goes from 16000 to 8000 on BOTH seats.",
    "Your team LP stays 16000.",
  ],
};
