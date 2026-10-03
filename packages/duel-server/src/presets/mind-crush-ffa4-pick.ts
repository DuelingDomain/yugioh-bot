import type { Preset } from "./types.js";

/** FFA4. Mind Crush makes the user pick ONE opponent when they activate it. The hand of that opponent is checked. */
export const preset: Preset = {
  id: "mind-crush-ffa4-pick",
  title: "Mind Crush picks one opponent (4 seats)",
  format: "ffa4",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-COMMON-OPP-PICK"],
  board: {
    format: "ffa4",
    p0: { spells: [{ card: "Mind Crush", pos: "set" }] },
    p1: { hand: ["Sangan"] },
    p2: { hand: ["Sangan"] },
    p3: { hand: ["Giant Rat"] },
  },
  bots: {
    1: [],
    2: [],
    3: [],
  },
  checklist: [
    "You start in Main Phase 1 with a set Mind Crush. Seats 1 and 2 each hold Sangan. Seat 3 holds Giant Rat.",
    "Activate Mind Crush. You are asked to pick ONE opponent (seat 1, 2 or 3).",
    "Pick seat 1 and name Sangan. Only seat 1 discards Sangan. Seat 2 keeps its Sangan.",
    "Activate is also legal for seat 3: if you name a card that seat 3 does not hold, you discard 1 card yourself.",
  ],
};
