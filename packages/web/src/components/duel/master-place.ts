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

/** The server may end a Deck Master Zone label with "(costs N LP)"; the table shows that cost itself, once. */
const COST_SUFFIX = /\s*\(costs ([\d,]+) LP\)\s*$/i;

function costText(cost: number): string {
  return cost > 0 ? `${cost.toLocaleString("en-US")} LP` : "Free";
}

/**
 * The text of a Deck Master action button. A Summon or Set from the zone shows its cost after the word ("Summon · 500 LP",
 * "Summon · Free" for the first), taken from the label suffix when the server sends one, else from `deckMaster.nextCost`.
 * The suffix is always removed so the cost shows once. With `short` the plate form is used: Summon and Set lose the
 * card name, and Activate loses the master's own name (the plate already names it), so the key words stay in a small
 * space. The full option text stays in the title and the accessible name.
 */
export function masterActionText(label: string, view: DuelSeatView | undefined, short: boolean): string {
  const suffix = COST_SUFFIX.exec(label);
  const base = label.replace(COST_SUFFIX, "");
  const fromSuffix = suffix ? Number.parseInt(suffix[1].replace(/,/g, ""), 10) : null;
  const move = /^(?:\w+ )?Summon\b/i.test(base) ? "Summon" : /^Set\b/i.test(base) ? "Set" : null;
  if (move) {
    const cost = fromSuffix ?? view?.deckMaster?.nextCost;
    const word = short ? move : base;
    return cost === undefined ? word : `${word} · ${costText(cost)}`;
  }
  let text = base;
  if (short) {
    const name = view?.deckMaster?.card.name;
    if (name && text.startsWith(`Activate ${name}`)) text = `Activate${text.slice(`Activate ${name}`.length)}`;
  }
  return fromSuffix === null ? text : `${text} · ${costText(fromSuffix)}`;
}
