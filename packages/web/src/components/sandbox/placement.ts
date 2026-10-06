/**
 * Pure placement rules of the builder UI: where a card goes when the user adds it to a target,
 * and which slots refuse it. Card data comes from the card search; an unknown card is never refused.
 */
import type { DeckCardInfo, SandboxDuelistId } from "@yugidraft/shared/duels";
import {
  TYPE_FIELD,
  TYPE_FUSION,
  TYPE_LINK,
  TYPE_MONSTER,
  TYPE_PENDULUM,
  TYPE_SPELL,
  TYPE_SYNCHRO,
  TYPE_TRAP,
  TYPE_XYZ,
} from "@/components/duel/constants";
import { getEntry, slotCount, type CardLoc, type PileZone, type SandboxBuilderState, type SandboxZone, type SlotZone } from "./board-model";

/** Where quick add sends a card. `field` picks the zone from the card type. */
export type AddTarget = PileZone | "field";

export const ADD_TARGETS: readonly { value: AddTarget; label: string }[] = [
  { value: "hand", label: "Hand" },
  { value: "field", label: "Field" },
  { value: "grave", label: "GY" },
  { value: "banished", label: "Banished" },
  { value: "deck", label: "Deck top" },
  { value: "extra", label: "Extra" },
];

type TypeInfo = Pick<DeckCardInfo, "type">;

export function isMonster(info: TypeInfo): boolean {
  return (info.type & TYPE_MONSTER) !== 0;
}
export function isSpellTrap(info: TypeInfo): boolean {
  return (info.type & (TYPE_SPELL | TYPE_TRAP)) !== 0;
}
export function isFieldSpell(info: TypeInfo): boolean {
  return (info.type & TYPE_SPELL) !== 0 && (info.type & TYPE_FIELD) !== 0;
}
export function isExtraDeckMonster(info: TypeInfo): boolean {
  return isMonster(info) && (info.type & (TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK)) !== 0;
}
export function isXyz(info: TypeInfo): boolean {
  return isMonster(info) && (info.type & TYPE_XYZ) !== 0;
}

/** Why a slot refuses this card, or null when it fits (or the card is unknown). */
export function slotRefusal(zone: SlotZone, info: TypeInfo | undefined): string | null {
  if (!info) return null;
  switch (zone) {
    case "monster":
      return isMonster(info) ? null : "Only monsters go in a Monster Zone.";
    case "spell":
      if (isFieldSpell(info)) return "Field Spells go in the Field Zone.";
      return isSpellTrap(info) ? null : "Only Spells and Traps go in a Spell & Trap Zone.";
    case "field":
      return isFieldSpell(info) ? null : "Only Field Spells go in the Field Zone.";
    case "pendulum":
      return isMonster(info) && (info.type & TYPE_PENDULUM) !== 0 ? null : "Only Pendulum Monsters go in a Pendulum Zone.";
    case "deckMaster":
      return isMonster(info) ? null : "A Deck Master is a monster.";
  }
}

/** First free slot of a zone, main zones before Extra Monster Zones. */
export function firstEmptySlot(state: SandboxBuilderState, seat: SandboxDuelistId, zone: SlotZone): CardLoc | null {
  const count = slotCount(state.board, zone);
  for (let index = 0; index < count; index += 1) {
    const loc: CardLoc = { seat, zone, index };
    if (getEntry(state, loc) === null) return loc;
  }
  return null;
}

export type Route =
  | { kind: "pile"; zone: PileZone; note?: string }
  | { kind: "slot"; zone: SlotZone }
  | { kind: "error"; message: string };

/**
 * Where `info` goes for a target. Extra Deck monsters sent to Hand or Deck top go to the Extra Deck
 * instead (a Fusion in the hand is never right). `field` follows the card type.
 */
export function routeCard(target: AddTarget, info: TypeInfo | undefined): Route {
  if (target === "field") {
    if (!info) return { kind: "slot", zone: "monster" };
    if (isFieldSpell(info)) return { kind: "slot", zone: "field" };
    if (isMonster(info)) return { kind: "slot", zone: "monster" };
    return { kind: "slot", zone: "spell" };
  }
  if (info && isExtraDeckMonster(info) && (target === "hand" || target === "deck")) {
    return { kind: "pile", zone: "extra", note: "Extra Deck monsters go to the Extra Deck." };
  }
  return { kind: "pile", zone: target };
}

export function zoneName(zone: SandboxZone): string {
  switch (zone) {
    case "monster":
      return "Monster Zone";
    case "spell":
      return "Spell & Trap Zone";
    case "field":
      return "Field Zone";
    case "pendulum":
      return "Pendulum Zone";
    case "deckMaster":
      return "Deck Master";
    case "hand":
      return "Hand";
    case "deck":
      return "Deck top";
    case "grave":
      return "Graveyard";
    case "banished":
      return "Banished";
    case "extra":
      return "Extra Deck";
  }
}
