/**
 * Where a seat's Deck Master is, read from the seat view. One reading for every Deck Master surface (the 1v1 dock, the
 * chip, the HUD plates, the seat-plate thumbs): the Deck Master Zone holds the card while `deckMaster.inZone` is true;
 * any other time the card is "in use", on the field or somewhere else (Graveyard, banished, hand, Extra Deck).
 */
import type { DuelCard, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_FZONE, LOCATION_MZONE, LOCATION_SZONE } from "./constants";

export type MasterPlace = "none" | "zone" | "field" | "elsewhere";

/** The Deck Master card as the seat view lists it outside its zone (field, Graveyard, banished, hand, Extra Deck). */
export function findMasterCard(view: DuelSeatView, code: number): DuelCard | null {
  const zones: Array<DuelCard | null | undefined> = [
    ...view.monsters,
    ...view.spells,
    ...view.graveyard,
    ...view.banished,
    ...view.hand,
    ...view.extra,
  ];
  for (const card of zones) {
    if (card?.code === code) return card;
  }
  return null;
}

export function masterPlace(view: DuelSeatView | undefined): MasterPlace {
  const master = view?.deckMaster;
  if (!view || !master) return "none";
  if (master.inZone) return "zone";
  const card = findMasterCard(view, master.card.code);
  if (card && (card.location === LOCATION_MZONE || card.location === LOCATION_SZONE || card.location === LOCATION_FZONE)) return "field";
  return "elsewhere";
}

/** The Deck Master is out of its zone: a table that shows the zone draws it empty, "in use", until the card returns. */
export function masterInUse(view: DuelSeatView | undefined): boolean {
  const place = masterPlace(view);
  return place === "field" || place === "elsewhere";
}

/**
 * The line a Deck Master panel shows while the card sits in its zone: what the next summon from the zone costs. The
 * first one is free (`nextCost` 0). Out of the zone there is no line, the card is in use.
 */
export function masterSummonLine(view: DuelSeatView | undefined): string | null {
  const master = view?.deckMaster;
  if (!master?.inZone) return null;
  return master.nextCost > 0 ? `Summon: costs ${master.nextCost.toLocaleString("en-US")} LP` : "Summon: free";
}
