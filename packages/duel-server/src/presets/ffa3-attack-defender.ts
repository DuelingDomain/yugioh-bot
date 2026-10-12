import { attackWith, choose, type Rule } from "../scripted-bot.js";
import type { Preset } from "./types.js";

/** Aims the declared attack at the human's monster, not at a direct hit. */
const attackHumanMonster: Rule = {
  note: "attack the human's monster",
  when: (prompt) => prompt.title === "Select an attack target" && prompt.options.some((option) => option.controller === 0 && !option.id.startsWith("direct")),
  do: (prompt) => ({ choice: prompt.options.find((option) => option.controller === 0 && !option.id.startsWith("direct"))!.id }),
};

export const preset: Preset = {
  id: "ffa3-attack-defender",
  title: "A rival attacks the human's monster while the human can respond",
  format: "ffa3",
  humanSeat: 0,
  needs: "multi-core",
  rules: ["R-FFA-ATTACK"],
  board: {
    format: "ffa3",
    attackFirstTurn: true,
    p0: {
      hand: ["Brain Control"],
      monsters: [null, null, null, "Warrior of Zera"],
      spells: [null, { card: "Phoenix Wing Wind Blast", pos: "set" }],
    },
    p1: { monsters: [null, null, "Gemini Elf"] },
    p2: { monsters: ["Celtic Guardian"] },
  },
  bots: {
    1: [attackWith("Gemini Elf"), attackHumanMonster, choose("to_bp"), choose("to_ep")],
    2: [],
  },
  checklist: [
    "Pass turn 1; seat 1 attacks Warrior of Zera on turn 2.",
    "While your response prompt is open, the arrow, the ring on Warrior of Zera and the attack line stay visible, and the prompt does not cover them.",
    "Reload the page in that window: the marker is still there.",
  ],
};
