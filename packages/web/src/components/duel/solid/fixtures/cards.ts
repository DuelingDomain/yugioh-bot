import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { TYPE_MONSTER, TYPE_NORMAL, TYPE_QUICKPLAY, TYPE_SPELL } from "../../constants";
import { ATTRIBUTE } from "../../attack-styles";
import { CARDS } from "../../fx-lab/cards";

/**
 * The cards of the concept states (docs/design/duel-3d-mode/concept/solid-vision/app.js, `CARD`), with their real
 * passcodes so the art loads. The ones the FX lab already has come from there; the rest are made here.
 */
const info = (code: number, name: string, type: number, attack: number, defense: number, level: number, attribute: number, race: string, description = ""): DuelCardInfo =>
  ({ code, name, description, type, attack, defense, level, attribute, race });

export const SOLID_CARDS = {
  darkMagician: CARDS.darkMagician,
  blueEyes: CARDS.blueEyes,
  celtic: CARDS.celtic,
  silverFang: CARDS.silverFang,
  trapHole: CARDS.trapHole,
  solemn: CARDS.solemn,
  beaver: info(32452818, "Beaver Warrior", TYPE_MONSTER | TYPE_NORMAL, 1200, 1500, 4, ATTRIBUTE.EARTH, "Beast-Warrior"),
  battleOx: info(5053103, "Battle Ox", TYPE_MONSTER | TYPE_NORMAL, 1700, 1000, 4, ATTRIBUTE.EARTH, "Beast-Warrior"),
  fissure: info(66788016, "Fissure", TYPE_SPELL, 0, 0, 0, 0, "", "Destroy the 1 face-up monster your opponent controls that has the lowest ATK."),
  bookOfMoon: info(14087893, "Book of Moon", TYPE_SPELL | TYPE_QUICKPLAY, 0, 0, 0, 0, "", "Target 1 face-up monster on the field; change it to face-down Defense Position."),
} as const satisfies Record<string, DuelCardInfo>;

