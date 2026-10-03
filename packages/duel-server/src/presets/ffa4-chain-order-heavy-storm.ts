import { chainWith, target } from "../scripted-bot.js";
import { onChain, type Preset } from "./types.js";

const dust = (seat: number) => [
  chainWith("Dust Tornado", { if: onChain, note: `seat ${seat} answers Heavy Storm with Dust Tornado` }),
  target({ card: "Swords of Revealing Light", owner: 0, nth: seat - 1 }, { note: `seat ${seat} targets Swords number ${seat}` }),
];

/**
 * FFA4. The human activates Heavy Storm. After that link the chance to respond goes clockwise from the next seat:
 * seat 1, seat 2, seat 3 (R-FFA-CHAIN). Each bot adds a Dust Tornado. The chain resolves in reverse: 3, 2, 1, then Heavy Storm.
 */
export const preset: Preset = {
  id: "ffa4-chain-order-heavy-storm",
  title: "Chain response order after Heavy Storm (4 seats)",
  format: "ffa4",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-FFA-CHAIN"],
  board: {
    format: "ffa4",
    p0: {
      hand: ["Heavy Storm"],
      spells: [0, 1, 2].map(() => ({ card: "Swords of Revealing Light", pos: "up" as const })),
    },
    p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    p3: { spells: [{ card: "Dust Tornado", pos: "set" }] },
  },
  bots: { 1: dust(1), 2: dust(2), 3: dust(3) },
  checklist: [
    "You start in Main Phase 1 with Heavy Storm. You control three face-up Swords of Revealing Light.",
    "Activate Heavy Storm (chain link 1).",
    "The chain window goes to seat 1 first, then seat 2, then seat 3. Each adds Dust Tornado: links 2, 3 and 4 in that order.",
    "You get your own chance after the bots. Pass.",
    "The chain resolves from the last link: seat 3, seat 2, seat 1, then Heavy Storm.",
  ],
};
