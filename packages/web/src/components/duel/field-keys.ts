import type { DuelCard, DuelMasterRule, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_MZONE, LOCATION_PZONE, LOCATION_SZONE, ST_COUNT, zoneKey } from "./constants";
import type { InspectTarget } from "./inspector";

// Pure zone-key helpers shared by the classic board (field.tsx), the field model hook and the Solid Vision table.

export type ZoneRef = { controller: number; location: number; sequence: number };

export type DuelActivateHandler = (
  keys: string[],
  card: DuelCard | null,
  anchor: HTMLElement,
  /** The click comes from the Card flyout or the pile viewer, not from the board: the HUD leaves its flyout and pin as they are. */
  preserveInspector?: boolean,
) => void;

export type DuelHoverHandler = (card: DuelCard | null, anchor: HTMLElement | null) => void;

export type FieldCallbacks = {
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
};

export function slot(cards: Array<DuelCard | null> | undefined, index: number): DuelCard | null {
  if (!cards || index < 0 || index >= cards.length) return null;
  return cards[index] ?? null;
}

export function extraMonster(
  bottom: DuelSeatView | undefined,
  top: DuelSeatView | undefined,
  side: "left" | "right",
): DuelCard | null {
  if (side === "left") return slot(bottom?.monsters, 5) ?? slot(top?.monsters, 6);
  return slot(bottom?.monsters, 6) ?? slot(top?.monsters, 5);
}

/**
 * Zone keys of one Extra Monster Zone slot. `shared-bottom` (1v1, today): the slot is the bottom seat's
 * zone 5 or 6 and the top seat's mirrored zone 6 or 5. `own` (3 or more seats): every seat has its own two
 * slots, so a slot holds only its seat's zone 5 (left) or 6 (right). The seat is `bottomSeat`.
 */
export type ExtraMonsterMode = "shared-bottom" | "shared-top" | "own";

export function extraMonsterKeys(
  bottomSeat: number,
  topSeat: number,
  side: "left" | "right",
  mode: ExtraMonsterMode = "shared-bottom",
): string[] {
  if (mode === "own") return [zoneKey(bottomSeat, LOCATION_MZONE, side === "left" ? 5 : 6)];
  if (mode === "shared-top") side = side === "left" ? "right" : "left";
  if (side === "left") {
    return [zoneKey(bottomSeat, LOCATION_MZONE, 5), zoneKey(topSeat, LOCATION_MZONE, 6)];
  }
  return [zoneKey(bottomSeat, LOCATION_MZONE, 6), zoneKey(topSeat, LOCATION_MZONE, 5)];
}

export function anyLegal(keys: string[], legal: Set<string>): boolean {
  for (const key of keys) {
    if (legal.has(key)) return true;
  }
  return false;
}

export function anySelected(keys: string[], selected: Set<string>): boolean {
  for (const key of keys) {
    if (selected.has(key)) return true;
  }
  return false;
}

export function cardZoneKey(card: DuelCard): string {
  return zoneKey(card.controller, card.location, card.sequence);
}

export function withExact(card: DuelCard | null, keys: string[]): string[] {
  if (!card) return keys;
  const exact = cardZoneKey(card);
  if (keys[0] === exact) return keys;
  return [exact, ...keys.filter((key) => key !== exact)];
}

export function pileHighlightKeys(seat: number, location: number, cards: DuelCard[]): string[] {
  if (cards.length === 0) return [zoneKey(seat, location, 0)];
  return cards.map(cardZoneKey);
}

export function stKeys(seat: number, sequence: number, card: DuelCard | null, masterRule: DuelMasterRule): string[] {
  const keys = [zoneKey(seat, LOCATION_SZONE, sequence)];
  const left = masterRule === 3 ? 6 : 0;
  const right = masterRule === 3 ? 7 : ST_COUNT - 1;
  if (masterRule >= 3 && sequence === left) keys.push(zoneKey(seat, LOCATION_PZONE, 0));
  if (masterRule >= 3 && sequence === right) keys.push(zoneKey(seat, LOCATION_PZONE, 1));
  return withExact(card, keys);
}
