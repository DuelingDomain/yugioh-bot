/**
 * Card behaviour for Remote Duels: what a card does to the board, read from the engine card scripts (offline, see
 * packages/duel-server/scripts/build-card-behaviour.ts). The mirrored board may use it as a prior to set defaults and break
 * ties. It never overrides what the camera sees. A card that is not in the table is unknown, not inert.
 * Pure and browser-safe: it only decodes the packed JSON that the web app imports.
 */
/** Where a card can be taken from. "opponent..." means the opponent's side. */
export const BEHAVIOUR_LOCATIONS = ["field", "opponentField", "hand", "opponentHand", "deck", "opponentDeck", "gy", "opponentGy", "banish", "opponentBanish", "extra", "opponentExtra"] as const;
/** Where a card can end up. banishDown = banished face-down; extraUp = face-up in the Extra Deck (a Pendulum Monster). */
export const BEHAVIOUR_DESTINATIONS = ["gy", "banish", "banishDown", "hand", "deck", "extra", "extraUp"] as const;
/** What an activation costs: this card moves itself, or its Xyz materials are detached. Discard goes to the GY too. */
export const BEHAVIOUR_COSTS = ["discard", "toGY", "banish", "toDeck", "toHand", "toExtra", "tribute", "detach"] as const;
export type BehaviourLocation = (typeof BEHAVIOUR_LOCATIONS)[number];
export type BehaviourDestination = (typeof BEHAVIOUR_DESTINATIONS)[number];
export type BehaviourCost = (typeof BEHAVIOUR_COSTS)[number];

export type CardBehaviour = {
  /** A Quick Effect that can be activated from the hand (a hand trap). */
  handQuick?: true;
  /** Costs where this card itself moves, or detaches its own materials. */
  cost?: BehaviourCost[];
  /** Costs that move other cards (discard, tribute, banish). */
  costOther?: Exclude<BehaviourCost, "detach">[];
  /** Materials detached per activation, as cost or effect. max 0 means the script decides the count. */
  detach?: { min: number; max: number };
  /** Cards this one takes as Xyz material, and where they come from (Duel.Overlay). */
  attach?: { from: BehaviourLocation[] };
  /** Where this card can send itself. */
  leaves?: BehaviourDestination[];
  /** Where this card can send other cards, and from where. An empty from means the script does not say. */
  sends?: { to: BehaviourDestination; from: BehaviourLocation[] }[];
  /** Draws cards. */
  draws?: true;
};

/** The packed file: SHAPES = one shape per word, IDS = one "|" group per shape (same order). Ids are base 36, sorted, then delta coded. */
export type CardBehaviourData = { SHAPES: string; IDS: string };

// One letter per value. Costs, destinations and locations each have their own letters.
const COST_CODES = "dgbkhxte", DEST_CODES = "gbfhdxu", LOC_CODES = "fFhHdDgGbBxX";
const code = <T extends string>(all: readonly T[], letters: string, value: T) => letters[all.indexOf(value)];
const sorted = <T extends string>(all: readonly T[], values: readonly T[]) => all.filter(value => values.includes(value));

/** The canonical shape string of a record (fixed field and value order, so equal records have equal shapes). */
export function encodeBehaviourShape(b: CardBehaviour): string {
  const out: string[] = [];
  const costs = (key: string, values: readonly BehaviourCost[] | undefined) => {
    if (values?.length) out.push(`${key}:${sorted(BEHAVIOUR_COSTS, values).map(v => code(BEHAVIOUR_COSTS, COST_CODES, v)).join("")}`);
  };
  const locations = (values: readonly BehaviourLocation[]) => sorted(BEHAVIOUR_LOCATIONS, values).map(v => code(BEHAVIOUR_LOCATIONS, LOC_CODES, v)).join("");
  if (b.handQuick) out.push("h");
  costs("c", b.cost); costs("o", b.costOther);
  if (b.detach) out.push(`x:${b.detach.min}-${b.detach.max}`);
  if (b.attach) out.push(`a:${locations(b.attach.from)}`);
  if (b.leaves?.length) out.push(`l:${sorted(BEHAVIOUR_DESTINATIONS, b.leaves).map(v => code(BEHAVIOUR_DESTINATIONS, DEST_CODES, v)).join("")}`);
  if (b.sends?.length) {
    const entries = [...b.sends].sort((a, c) => BEHAVIOUR_DESTINATIONS.indexOf(a.to) - BEHAVIOUR_DESTINATIONS.indexOf(c.to));
    out.push(`s:${entries.map(entry => code(BEHAVIOUR_DESTINATIONS, DEST_CODES, entry.to) + locations(entry.from)).join(",")}`);
  }
  if (b.draws) out.push("w");
  return out.join(";");
}

const decodeList = <T extends string>(all: readonly T[], letters: string, text: string) => [...text].map(letter => all[letters.indexOf(letter)]);
/** The record of a shape string. */
export function decodeBehaviourShape(shape: string): CardBehaviour {
  const b: CardBehaviour = {};
  for (const field of shape.split(";")) {
    const [key, value = ""] = [field[0], field.slice(2)];
    if (key === "h") b.handQuick = true;
    else if (key === "w") b.draws = true;
    else if (key === "c") b.cost = decodeList(BEHAVIOUR_COSTS, COST_CODES, value);
    else if (key === "o") b.costOther = decodeList(BEHAVIOUR_COSTS, COST_CODES, value) as Exclude<BehaviourCost, "detach">[];
    else if (key === "x") { const [min, max] = value.split("-").map(Number); b.detach = { min, max }; }
    else if (key === "a") b.attach = { from: decodeList(BEHAVIOUR_LOCATIONS, LOC_CODES, value) };
    else if (key === "l") b.leaves = decodeList(BEHAVIOUR_DESTINATIONS, DEST_CODES, value);
    else if (key === "s") b.sends = value.split(",").map(entry => ({ to: decodeList(BEHAVIOUR_DESTINATIONS, DEST_CODES, entry[0])[0], from: decodeList(BEHAVIOUR_LOCATIONS, LOC_CODES, entry.slice(1)) }));
  }
  return b;
}

/** Packs records by passcode (aliases already added by the builder) into the canonical file content. Used by the builder. */
export function packCardBehaviour(records: ReadonlyMap<number, CardBehaviour>): CardBehaviourData {
  const byShape = new Map<string, number[]>();
  for (const [id, record] of records) {
    const shape = encodeBehaviourShape(record);
    if (shape) byShape.set(shape, [...(byShape.get(shape) ?? []), id]);
  }
  const shapes = [...byShape.keys()].sort();
  const groups = shapes.map(shape => {
    let last = 0;
    return byShape.get(shape)!.sort((a, b) => a - b).map(id => { const step = id - last; last = id; return step.toString(36); }).join(" ");
  });
  return { SHAPES: shapes.join(" "), IDS: groups.join("|") };
}

export type CardBehaviourTable = {
  /** The behaviour of a card, or undefined when the scan found nothing (unknown, not inert). Do not mutate the result. */
  get(id: number | undefined): Readonly<CardBehaviour> | undefined;
  /** How many card ids have a record. */
  readonly size: number;
};

/** A reader over the packed data. It decodes on first use and shares one record between cards with the same shape. */
export function createCardBehaviour(data: CardBehaviourData): CardBehaviourTable {
  let table: Map<number, CardBehaviour> | undefined;
  const load = () => {
    if (table) return table;
    const loaded = new Map<number, CardBehaviour>();
    table = loaded;
    const shapes = data.SHAPES ? data.SHAPES.split(" ") : [];
    data.IDS.split("|").forEach((group, index) => {
      if (!group) return;
      const record = decodeBehaviourShape(shapes[index]);
      let id = 0;
      for (const step of group.split(" ")) { id += parseInt(step, 36); loaded.set(id, record); }
    });
    return loaded;
  };
  return { get: id => (id === undefined ? undefined : load().get(id)), get size() { return load().size; } };
}
