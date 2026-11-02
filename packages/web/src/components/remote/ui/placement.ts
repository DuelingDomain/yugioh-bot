import { isMonsterInfo, type CardInfo } from "./catalog";
import { cellsFor, foundationZone, frameOf, mirrorEmz, PENDULUM_CELLS, type TwinCard, type ZoneKey } from "./model";

/** Where a card goes: a twin zone with an optional slot. */
export type Landing = { zone: string; slot?: number };
/** ok = move now. confirm = legal only as a special case, ask once. refuse = say why, change nothing. same = dropped where it already is. */
export type Verdict = { kind: "ok" | "same" } | { kind: "confirm" | "refuse"; message: string };

const EXTRA_FRAMES = new Set(["fusion", "synchro", "xyz", "link"]);

export type CardKind = "monster" | "extra" | "pendulum" | "spell" | "trap" | "field" | "unknown";
/** What the card is, from the catalog. A card without catalog data is unknown and can go anywhere. */
export function kindOf(info: CardInfo | undefined): CardKind {
  if (!info) return "unknown";
  const frame = frameOf(info);
  if (frame === "spell") return /field/i.test(info.type) ? "field" : "spell";
  if (frame === "trap") return "trap";
  if (EXTRA_FRAMES.has(frame)) return "extra";
  if (frame === "pendulum") return "pendulum";
  return isMonsterInfo(info) ? "monster" : "unknown";
}

const PILES = new Set(["graveyard", "banished", "hand", "deck", "extra"]);

/** The twin landing for a grid cell. A Pendulum monster on an outer Spell/Trap cell takes a Pendulum Zone when the format has them. */
export function landingForCell(key: ZoneKey, info: CardInfo | undefined, extraZones: boolean): Landing {
  if (extraZones && kindOf(info) === "pendulum" && (key === PENDULUM_CELLS[1] || key === PENDULUM_CELLS[2])) return { zone: "pendulum", slot: key === PENDULUM_CELLS[1] ? 1 : 2 };
  return foundationZone(key);
}

/** The grid cell a landing draws on, or null for zones without a cell (hand, banished). */
export function cellForLanding(land: Landing): ZoneKey | null {
  switch (land.zone) {
    case "monster": return land.slot ? (`m${land.slot}` as ZoneKey) : null;
    case "spell-trap": return land.slot ? (`s${land.slot}` as ZoneKey) : null;
    case "pendulum": return land.slot === 2 ? PENDULUM_CELLS[2] : PENDULUM_CELLS[1];
    case "extra-monster": return land.slot ? (`e${land.slot}` as ZoneKey) : null;
    case "field": return "f";
    default: return null;
  }
}

export const landingLabel = (land: Landing): string => {
  switch (land.zone) {
    case "monster": return `Monster Zone ${land.slot ?? ""}`.trim();
    case "spell-trap": return `Spell/Trap Zone ${land.slot ?? ""}`.trim();
    case "pendulum": return `Pendulum Zone ${land.slot ?? ""}`.trim();
    case "extra-monster": return land.slot === 2 ? "right Extra Monster Zone" : land.slot === 1 ? "left Extra Monster Zone" : "Extra Monster Zone";
    case "field": return "the Field Zone";
    case "graveyard": return "the Graveyard";
    case "banished": return "banished";
    case "hand": return "the hand";
    case "extra": return "the Extra Deck";
    case "deck": return "the Deck";
    default: return land.zone;
  }
};

/**
 * Can this card go there? One policy for drag, keyboard and voice.
 * Occupied zone: refuse with a short message (never swap), so one drag is always one action with one Undo.
 */
export function judgeMove(args: {
  card: TwinCard; info: CardInfo | undefined; land: Landing; twin: readonly TwinCard[]; extraZones: boolean;
  /** The seat that shares the Extra Monster Zones with this one. */
  facing?: { name: string; twin: readonly TwinCard[] } | null;
}): Verdict {
  const { card, info, land, twin, extraZones, facing } = args;
  const kind = kindOf(info);
  if (land.zone === "extra-monster" || land.zone === "pendulum") if (!extraZones) return { kind: "refuse", message: "This format has no Extra Monster or Pendulum Zones." };
  const cell = cellForLanding(land);
  if (cell) {
    const holder = cellsFor(twin, extraZones)[cell].card;
    if (holder && holder.ref === card.ref) return { kind: "same" };
    if (holder) return { kind: "refuse", message: `${labelOfCell(land)} is taken. Move that card first.` };
    if (land.zone === "extra-monster" && land.slot) {
      const shared = facing?.twin.find(other => other.zone === "extra-monster" && other.slot === mirrorEmz(land.slot!));
      if (shared) return { kind: "refuse", message: `That Extra Monster Zone is shared with ${facing!.name} and taken.` };
    }
  } else if (card.zone === land.zone && (land.zone === "graveyard" || land.zone === "banished" || land.zone === "hand" || land.zone === "extra" || land.zone === "deck")) return { kind: "same" };
  if (PILES.has(land.zone)) {
    if (land.zone === "extra" && (kind === "monster" || kind === "spell" || kind === "trap" || kind === "field")) return { kind: "refuse", message: "Only Extra Deck and Pendulum monsters go to the Extra Deck." };
    return { kind: "ok" };
  }
  if (kind === "unknown") return { kind: "ok" };
  if (land.zone === "field") return kind === "field" ? { kind: "ok" } : { kind: "refuse", message: "Only Field Spells go in the Field Zone." };
  if (kind === "field") return { kind: "refuse", message: "Field Spells go in the Field Zone." };
  if (land.zone === "monster") {
    if (kind === "trap") return { kind: "confirm", message: "Place this Trap as a Trap Monster?" };
    if (kind === "spell") return { kind: "refuse", message: "Spells do not go in a Monster Zone." };
    return { kind: "ok" };
  }
  if (land.zone === "extra-monster") {
    if (kind === "extra" || kind === "pendulum") return { kind: "ok" };
    return { kind: "refuse", message: "Only Extra Deck monsters go in an Extra Monster Zone." };
  }
  if (land.zone === "pendulum") return { kind: "ok" };
  if (land.zone === "spell-trap") {
    if (kind === "spell" || kind === "trap" || kind === "pendulum") return { kind: "ok" };
    return { kind: "confirm", message: "Place this monster in a Spell/Trap Zone (for example as a Continuous Spell)?" };
  }
  return { kind: "ok" };
}

const labelOfCell = (land: Landing) => { const text = landingLabel(land); return text.charAt(0).toUpperCase() + text.slice(1); };
