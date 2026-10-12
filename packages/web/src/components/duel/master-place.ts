/**
 * Where a seat's Deck Master is, read from the seat view. One reading for every Deck Master surface (the 1v1 dock, the
 * chip, the HUD plates, the seat-plate thumbs): the Deck Master Zone holds the card while `deckMaster.inZone` is true;
 * any other time the card is "in use", on the field or somewhere else (Graveyard, banished, hand, Extra Deck).
 */
import { createContext, useContext } from "react";
import type { DuelCard, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_FZONE, LOCATION_MZONE, LOCATION_SZONE } from "./constants";

export type MasterPlace = "none" | "zone" | "field" | "elsewhere";

/**
 * Every seat view of the live table. A Deck Master can be on another seat's field (Change of Heart): the card then
 * shows in that seat's view, not in its owner's. The room provides the views; without a provider only the owner's view
 * is searched.
 */
export const MasterSeatsContext = createContext<readonly DuelSeatView[]>([]);
export function useMasterSeats(): readonly DuelSeatView[] {
  return useContext(MasterSeatsContext);
}

/**
 * The Deck Master card as the seat view lists it outside its zone (field, Graveyard, banished, hand, Extra Deck). With
 * `seats`, a face-up card with the same code on another seat's field counts too (the master was taken).
 */
export function findMasterCard(view: DuelSeatView, code: number, seats: readonly DuelSeatView[] = []): DuelCard | null {
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
  for (const other of seats) {
    if (other.seat === view.seat) continue;
    for (const card of [...other.monsters, ...other.spells]) {
      if (card?.code === code) return card;
    }
  }
  return null;
}

export function masterPlace(view: DuelSeatView | undefined, seats: readonly DuelSeatView[] = []): MasterPlace {
  const master = view?.deckMaster;
  if (!view || !master) return "none";
  if (master.inZone) return "zone";
  const card = findMasterCard(view, master.card.code, seats);
  if (card && (card.location === LOCATION_MZONE || card.location === LOCATION_SZONE || card.location === LOCATION_FZONE)) return "field";
  return "elsewhere";
}

/** The Deck Master is out of its zone: a table that shows the zone draws it empty, "in use", until the card returns. */
export function masterInUse(view: DuelSeatView | undefined, seats: readonly DuelSeatView[] = []): boolean {
  const place = masterPlace(view, seats);
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

/**
 * The server ends the label of a Deck Master Zone summon with this suffix ("Normal Summon X (costs 500 LP)"). The table
 * shows that cost itself, once, so the suffix is removed from the text. `tests/duel-master-in-use.test.tsx` pins it.
 */
export const COST_SUFFIX = /\s*\(costs ([\d,]+) LP\)\s*$/i;

function costText(cost: number): string {
  return cost > 0 ? `${cost.toLocaleString("en-US")} LP` : "Free";
}

/**
 * The kind of an idle command, by its id prefix (duel-server `idleOptions`): "summon:", "spsummon:", "mset:" are
 * Summons (Special Summons and monster Sets count too), "sset:" a Set. Anything else (Activate, Attack, position) is null.
 */
export function moveKind(option: DuelPromptOption): "Summon" | "Set" | null {
  if (/^(?:summon|spsummon):/.test(option.id)) return "Summon";
  if (/^(?:mset|sset):/.test(option.id)) return "Set";
  return null;
}

/** The option leaves the Deck Master Zone: the master is in its zone and the option is not from hand, Graveyard or Extra Deck. */
function fromMasterZone(option: DuelPromptOption, view: DuelSeatView | undefined): boolean {
  if (!view?.deckMaster?.inZone) return false;
  return option.location === undefined || option.location === 0 || option.location === LOCATION_DMZONE;
}

/** An action button as words: the label to show and, for a Summon or Set from the zone, its cost ("500 LP" or "Free"). */
export interface MasterActionParts {
  text: string;
  cost: string | null;
  /** A Summon or Set: it shares a row with Inspect on the plate. Other actions (Activate) take a whole row. */
  move: boolean;
}

/**
 * The words of a Deck Master action button. A Summon or Set from the zone has a cost ("500 LP", "Free" for the first),
 * taken from the label suffix when the server sends one, else from `deckMaster.nextCost`. Only the zone costs: the same
 * master summoned from hand, Graveyard or Extra Deck has none. The suffix is always removed so the cost shows once. With
 * `short` the plate form is used: Summon and Set lose the card name, and Activate loses the master's own name (the plate
 * already names it), so the key words stay in a small space. The full option text stays in the title.
 */
export function masterActionParts(option: DuelPromptOption, view: DuelSeatView | undefined, short: boolean): MasterActionParts {
  const suffix = COST_SUFFIX.exec(option.label);
  const base = option.label.replace(COST_SUFFIX, "");
  const fromSuffix = suffix ? Number.parseInt(suffix[1].replace(/,/g, ""), 10) : null;
  const move = moveKind(option);
  if (move) {
    const cost = fromMasterZone(option, view) ? (fromSuffix ?? view?.deckMaster?.nextCost ?? null) : fromSuffix;
    return { text: short ? move : base, cost: cost === null ? null : costText(cost), move: true };
  }
  let text = base;
  if (short) {
    const name = view?.deckMaster?.card.name;
    if (name && text.startsWith(`Activate ${name}`)) text = `Activate${text.slice(`Activate ${name}`.length)}`;
  }
  return { text, cost: fromSuffix === null ? null : costText(fromSuffix), move: false };
}

/** The text of a Deck Master action button in one line: "Summon · 500 LP". The accessible name uses it with `short` off. */
export function masterActionText(option: DuelPromptOption, view: DuelSeatView | undefined, short: boolean): string {
  const { text, cost } = masterActionParts(option, view, short);
  return cost === null ? text : `${text} · ${cost}`;
}
