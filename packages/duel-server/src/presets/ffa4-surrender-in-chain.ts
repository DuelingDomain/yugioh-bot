import { chainWith, surrender, target } from "../scripted-bot.js";
import { onChain, type Preset } from "./types.js";

/**
 * FFA4. Seat 1 answers Heavy Storm with Dust Tornado, then surrenders while its own link is still on the chain
 * (R-FFA-ELIMINATION). Its link resolves with no effect, its cards leave the game, the duel goes on with three seats.
 */
export const preset: Preset = {
  id: "ffa4-surrender-in-chain",
  title: "Elimination by surrender inside a chain (4 seats)",
  format: "ffa4",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-FFA-ELIMINATION", "R-FFA-WINNER"],
  board: {
    format: "ffa4",
    p0: { hand: ["Heavy Storm"], spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
    p1: { spells: [{ card: "Dust Tornado", pos: "set" }], monsters: [{ card: "Gemini Elf", pos: "atk" }] },
    p2: { monsters: [{ card: "Giant Rat", pos: "atk" }] },
    p3: {},
  },
  bots: {
    1: [
      surrender({
        note: "give up while my Dust Tornado link is on the chain",
        if: (_prompt, view) => view.chain.some((link) => link.seat === 1),
      }),
      chainWith("Dust Tornado", { if: onChain, note: "answer Heavy Storm with Dust Tornado" }),
      target({ card: "Swords of Revealing Light", owner: 0 }, { note: "Dust Tornado targets the Spell of the human" }),
    ],
    2: [],
    3: [],
  },
  checklist: [
    "You start in Main Phase 1 with Heavy Storm. Activate it (chain link 1).",
    "Seat 1 adds Dust Tornado (link 2).",
    "Seat 1 then surrenders while its link is on the chain. Seat 1 is shown as eliminated.",
    "The Dust Tornado link of seat 1 resolves with no effect: your Swords of Revealing Light is destroyed only by Heavy Storm.",
    "The Gemini Elf of seat 1 is gone (its cards left the game).",
    "The duel goes on with seats 0, 2 and 3. No winner yet.",
  ],
};
