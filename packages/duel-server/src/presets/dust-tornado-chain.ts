import { chainWith, target } from "../scripted-bot.js";
import { onChain, type Preset } from "./types.js";

/**
 * 1v1. The human uses Mystical Space Typhoon on the bot's set Dust Tornado. The bot chains Dust Tornado on the human's
 * face-up Swords of Revealing Light. Dust Tornado resolves first (chain link 2), then Mystical Space Typhoon.
 */
export const preset: Preset = {
  id: "dust-tornado-chain",
  title: "Chain response: Dust Tornado",
  format: "1v1",
  humanSeat: 0,
  rules: ["R-COMMON-OPP-FIELD"],
  board: {
    p0: { hand: ["Mystical Space Typhoon"], spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
    p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
  },
  bots: {
    1: [
      chainWith("Dust Tornado", { if: onChain, note: "respond to the attack on my Trap with Dust Tornado" }),
      target({ card: "Swords of Revealing Light", owner: 0 }, { note: "Dust Tornado targets the opponent's Spell" }),
    ],
  },
  checklist: [
    "You start in your Main Phase 1 with Mystical Space Typhoon in your hand.",
    "Activate Mystical Space Typhoon and target the face-down card of the bot.",
    "The bot answers with Dust Tornado: the chain has two links (1 Mystical Space Typhoon, 2 Dust Tornado).",
    "You get a chance to respond. Pass.",
    "Dust Tornado resolves first and destroys your Swords of Revealing Light.",
    "Mystical Space Typhoon resolves next and destroys Dust Tornado.",
    "Final board: your grave has Mystical Space Typhoon and Swords of Revealing Light. The bot grave has Dust Tornado.",
  ],
};
