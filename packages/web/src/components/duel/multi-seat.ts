import {
  opponentSeatsOf,
  partnerSeatOf,
  seatCountFor,
  sharedExtraSeatOf,
  teamOfSeat,
  type DuelEngineView,
  type DuelAnswer,
  type DuelFormat,
  type DuelPrompt,
  type DuelSeatView,
} from "@yugidraft/shared/duels";
import { LOCATION_MZONE } from "./constants";

/** How a seat relates to the viewer. Spectators see every seat as "other". */
export type SeatRelation = "self" | "partner" | "opponent" | "other";

const FORMAT_LABEL: Record<DuelFormat, string> = { "1v1": "1v1", tag: "Tag 2v2", ffa3: "3-player FFA", ffa4: "4-player FFA" };

export function formatLabel(format: DuelFormat): string {
  return FORMAT_LABEL[format];
}

/** The table format of a view. Views made before multi-player formats have no field: read the seat count. */
export function engineFormat(engine: Pick<DuelEngineView, "format" | "seats"> | null | undefined): DuelFormat {
  if (engine?.format) return engine.format;
  const count = engine?.seats.length ?? 2;
  return count === 3 ? "ffa3" : count >= 4 ? "ffa4" : "1v1";
}

/** True for 3 and 4 seat tables. The 1v1 room keeps its own layout. */
export function isMultiSeat(engine: Pick<DuelEngineView, "format" | "seats"> | null | undefined): boolean {
  return engine != null && (engine.seats.length > 2 || (engine.format != null && seatCountFor(engine.format) > 2));
}

export function seatRelation(format: DuelFormat, mySeat: number | null, seat: number): SeatRelation {
  if (mySeat == null) return "other";
  if (seat === mySeat) return "self";
  if (partnerSeatOf(format, mySeat) === seat) return "partner";
  return "opponent";
}

/** Seats an attack or effect of the viewer can hit. A spectator has none. */
export function foeSeats(format: DuelFormat, mySeat: number | null): number[] {
  return mySeat == null ? [] : opponentSeatsOf(format, mySeat);
}

export function seatTeam(format: DuelFormat, view: Pick<DuelSeatView, "seat" | "team">): number {
  return view.team ?? teamOfSeat(format, view.seat);
}

/**
 * An opponent pick: the activating seat chooses the one opponent that a hand, Deck, draw or LP effect binds.
 * The engine marks the prompt `context.type === "opponent"` and gives every option `controller: seat`.
 */
export function isOpponentPick(prompt: DuelPrompt | null | undefined): prompt is DuelPrompt {
  return prompt?.kind === "choice" && prompt.context?.type === "opponent";
}

/** What the table needs to let the player click a seat to answer an opponent pick. */
export interface SeatPick {
  /** Seat to option id of the pick. Only seats that can be chosen. */
  options: ReadonlyMap<number, string>;
  /** Answers the prompt with the option of that seat. */
  onPick: (seat: number) => void;
}

/** Seat to option id of an opponent pick. Seats that are out of the duel and options with no seat are left out. */
export function opponentPickOptions(
  prompt: DuelPrompt | null | undefined,
  engine?: Pick<DuelEngineView, "seats"> | null,
): Map<number, string> {
  const picks = new Map<number, string>();
  if (!isOpponentPick(prompt)) return picks;
  for (const option of prompt.options) {
    if (option.controller == null || picks.has(option.controller)) continue;
    const view = engine?.seats.find((seat) => seat.seat === option.controller);
    if (isEliminated(view)) continue;
    picks.set(option.controller, option.id);
  }
  return picks;
}

export function seatPickFor(
  prompt: DuelPrompt | null | undefined,
  engine: Pick<DuelEngineView, "seats"> | null | undefined,
  onAnswer: (answer: DuelAnswer) => void,
): SeatPick | null {
  const options = opponentPickOptions(prompt, engine);
  if (!options.size) return null;
  return { options, onPick: (seat) => {
    const choice = options.get(seat);
    if (choice != null) onAnswer({ choice });
  } };
}

/** The option label shown for one seat of an opponent pick: the seat's display name. */
export function opponentPickLabel(name: string): string {
  return `Choose ${name} as the opponent`;
}

/**
 * Seat name lookup for the table. Display names repeat when a table has several practice bots, so a name shared
 * by more than one seat gets its seat number ("Practice Bot (seat 3)"). Unique names are left as they are.
 */
export function seatNamer(seats: ReadonlyArray<{ seat: number; displayName: string }>): (seat: number) => string {
  const key = (name: string) => name.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const player of seats) counts.set(key(player.displayName), (counts.get(key(player.displayName)) ?? 0) + 1);
  return (seat) => {
    const player = seats.find((candidate) => candidate.seat === seat);
    if (!player) return `Player ${seat + 1}`;
    return (counts.get(key(player.displayName)) ?? 0) > 1 ? `${player.displayName} (seat ${seat + 1})` : player.displayName;
  };
}

export function isEliminated(view: DuelSeatView | undefined): boolean {
  return view?.eliminated === true;
}

/** Each reciprocal living FFA4 across pair once, in seat order. Older views keep separate EMZ rows. */
export function sharedExtraPairs(engine: Pick<DuelEngineView, "format" | "seats">): Array<[DuelSeatView, DuelSeatView]> {
  if (engineFormat(engine) !== "ffa4") return [];
  const bySeat = new Map(engine.seats.map((view) => [view.seat, view]));
  const pairs: Array<[DuelSeatView, DuelSeatView]> = [];
  for (const view of engine.seats) {
    const across = view.sharedExtraWith;
    if (across == null || across <= view.seat || across !== sharedExtraSeatOf("ffa4", view.seat) || isEliminated(view)) continue;
    const other = bySeat.get(across);
    // Older cores can occupy both mirrored cells. Keep both rows so neither card is hidden.
    if (other && ((view.monsters[5] && other.monsters[6]) || (view.monsters[6] && other.monsters[5]))) continue;
    if (other && !isEliminated(other) && other.sharedExtraWith === view.seat) pairs.push([view, other]);
  }
  return pairs.sort(([a], [b]) => a.seat - b.seat);
}

/** The seat that plays after `seat`, skipping eliminated seats. Null when no other seat is alive. */
export function nextSeatAfter(seats: readonly DuelSeatView[], seat: number): number | null {
  const ordered = [...seats].sort((a, b) => a.seat - b.seat);
  const start = ordered.findIndex((entry) => entry.seat === seat);
  if (start < 0) return null;
  for (let step = 1; step < ordered.length; step += 1) {
    const candidate = ordered[(start + step) % ordered.length];
    if (!isEliminated(candidate)) return candidate.seat;
  }
  return null;
}

/** Zone keys look like `controller:location:sequence`; the controller is the seat whose board holds the zone. */
export function seatOfZoneKey(key: string): number | null {
  const seat = Number(key.split(":")[0]);
  return Number.isInteger(seat) ? seat : null;
}

/**
 * The opponent whose board fills the main field. It is the opponent with a legal zone or card when the
 * viewer must pick one, else the player on turn when it is an opponent, else the first live opponent.
 * `pinned` (the viewer tapped a seat) wins when that seat is still a valid choice.
 */
export function focusOpponentSeat(args: {
  engine: Pick<DuelEngineView, "format" | "seats" | "turnSeat">;
  mySeat: number | null;
  legalKeys: ReadonlySet<string>;
  pinned?: number | null;
}): number | null {
  const { engine, mySeat, legalKeys, pinned } = args;
  const format = engineFormat(engine);
  const foes = engine.seats.filter((view) => view.seat !== mySeat && (mySeat == null || seatRelation(format, mySeat, view.seat) === "opponent"));
  if (foes.length === 0) return null;
  const alive = foes.filter((view) => !isEliminated(view));
  const pool = alive.length > 0 ? alive : foes;
  if (pinned != null && pool.some((view) => view.seat === pinned)) return pinned;
  const hit = new Set<number>();
  for (const key of legalKeys) {
    const seat = seatOfZoneKey(key);
    if (seat != null) hit.add(seat);
  }
  const targeted = pool.find((view) => hit.has(view.seat));
  if (targeted) return targeted.seat;
  const onTurn = pool.find((view) => view.seat === engine.turnSeat);
  return (onTurn ?? pool[0]).seat;
}

/**
 * Seats in the order they sit around the viewer. FFA: turn order (clockwise) from the seat after the viewer,
 * so the seat that acts next comes first. Tag: the partner first, then the opposing team in turn order.
 * Spectator: seat 0 is the anchor; Tag groups each team together, team of seat 0 first.
 */
export function placementOrder(engine: Pick<DuelEngineView, "format" | "seats">, mySeat: number | null): number[] {
  const format = engineFormat(engine);
  const seats = [...engine.seats].sort((a, b) => a.seat - b.seat);
  const count = seats.length;
  const numbers = seats.map((view) => view.seat);
  if (mySeat == null) {
    if (format !== "tag") return numbers;
    const first = seatTeam(format, seats[0]);
    const rank = (view: DuelSeatView) => (seatTeam(format, view) === first ? 0 : 1);
    return [...seats].sort((a, b) => rank(a) - rank(b) || a.seat - b.seat).map((view) => view.seat);
  }
  const start = numbers.indexOf(mySeat);
  if (start < 0) return numbers;
  const around = Array.from({ length: count - 1 }, (_, step) => numbers[(start + 1 + step) % count]);
  if (format !== "tag") return around;
  const partner = around.filter((seat) => seatRelation(format, mySeat, seat) === "partner");
  return [...partner, ...around.filter((seat) => !partner.includes(seat))];
}

/** Seats shown as compact boards: every seat except the viewer and the focused opponent, in placement order. */
export function compactSeats(engine: Pick<DuelEngineView, "format" | "seats">, mySeat: number | null, focusSeat: number | null): DuelSeatView[] {
  const bySeat = new Map(engine.seats.map((view) => [view.seat, view] as const));
  return placementOrder(engine, mySeat)
    .filter((seat) => seat !== mySeat && seat !== focusSeat)
    .map((seat) => bySeat.get(seat))
    .filter((view): view is DuelSeatView => view != null);
}

export type RailGroup = { id: "seats" | "opponents" | "partner" | "team-a" | "team-b"; seats: DuelSeatView[] };

/**
 * The compact boards split in visual groups. FFA: one group. Tag player: opposing team on top, the partner
 * last (next to the viewer's field). Tag spectator: one group for each team.
 */
export function railGroups(engine: Pick<DuelEngineView, "format" | "seats">, mySeat: number | null, focusSeat: number | null): RailGroup[] {
  const format = engineFormat(engine);
  const boards = compactSeats(engine, mySeat, focusSeat);
  if (format !== "tag") return boards.length > 0 ? [{ id: "seats", seats: boards }] : [];
  const groups: RailGroup[] = [];
  if (mySeat == null) {
    const first = boards.length > 0 ? seatTeam(format, engine.seats.find((view) => view.seat === placementOrder(engine, null)[0]) ?? boards[0]) : 0;
    groups.push({ id: "team-a", seats: boards.filter((view) => seatTeam(format, view) === first) });
    groups.push({ id: "team-b", seats: boards.filter((view) => seatTeam(format, view) !== first) });
  } else {
    groups.push({ id: "opponents", seats: boards.filter((view) => seatRelation(format, mySeat, view.seat) === "opponent") });
    groups.push({ id: "partner", seats: boards.filter((view) => seatRelation(format, mySeat, view.seat) === "partner") });
  }
  return groups.filter((group) => group.seats.length > 0);
}

/**
 * Disabled zones of one seat, from the optional `disabledZones` bit mask of its view. Same layout as the
 * 1v1 mask of one player: bits 0-6 Main and Extra Monster Zones (sequence 0-6), bits 8-12 Spell & Trap
 * Zones (sequence 0-4), bit 13 Field Zone, bits 14-15 the two Master Rule 3 Pendulum Zones (Spell and Trap
 * sequence 6 and 7).
 */
export type DisabledZones = { monsters: boolean[]; spells: boolean[]; pendulum: boolean[]; field: boolean; any: boolean };

export function seatDisabledMask(view: object | null | undefined): number {
  const mask = (view as { disabledZones?: number } | null | undefined)?.disabledZones;
  return typeof mask === "number" && Number.isFinite(mask) ? mask >>> 0 : 0;
}

export function disabledZones(view: object | null | undefined): DisabledZones {
  const mask = seatDisabledMask(view);
  const monsters = Array.from({ length: 7 }, (_, index) => (mask & (1 << index)) !== 0);
  const spells = Array.from({ length: 5 }, (_, index) => (mask & (1 << (8 + index))) !== 0);
  const pendulum = [(mask & (1 << 14)) !== 0, (mask & (1 << 15)) !== 0];
  const field = (mask & (1 << 13)) !== 0;
  return { monsters, spells, pendulum, field, any: field || monsters.some(Boolean) || spells.some(Boolean) || pendulum.some(Boolean) };
}

/** Short names of the disabled zones of a seat, for a text note. */
export function disabledZoneNames(view: object | null | undefined): string[] {
  const zones = disabledZones(view);
  const names: string[] = [];
  zones.monsters.forEach((off, index) => { if (off) names.push(index < 5 ? `Monster zone ${index + 1}` : `Extra monster zone ${index - 4}`); });
  zones.spells.forEach((off, index) => { if (off) names.push(`Spell and trap zone ${index + 1}`); });
  if (zones.field) names.push("Field zone");
  zones.pendulum.forEach((off, index) => { if (off) names.push(`${index === 0 ? "Left" : "Right"} pendulum zone`); });
  return names;
}

/**
 * DuelField mirrors the two halves into one EMZ band (1v1). At multi-seat tables, the focused opponent's
 * separate EMZ and any FFA4 shared pairs are drawn outside that field, so remove their cards from its view.
 */
export function withoutSeatExtraZones(engine: DuelEngineView, seat: number | null, sharedSeats: ReadonlySet<number> = new Set()): DuelEngineView {
  if (seat == null && sharedSeats.size === 0) return engine;
  return {
    ...engine,
    seats: engine.seats.map((view) => (view.seat === seat || sharedSeats.has(view.seat) ? { ...view, monsters: view.monsters.slice(0, 5) } : view)),
  };
}

/** Remove EMZ keys whose cells are outside DuelField, in a separate or shared row. */
export function withoutSeatExtraKeys(keys: ReadonlySet<string>, seat: number | null, sharedSeats: ReadonlySet<number> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const [controller, location, sequence] = key.split(":");
    if ((Number(controller) === seat || sharedSeats.has(Number(controller))) && Number(location) === LOCATION_MZONE && (sequence === "5" || sequence === "6")) continue;
    out.add(key);
  }
  return out;
}

/** Names of the winning side: one name in 1v1 and FFA, both partners in Tag. */
export function winnerSeats(engine: Pick<DuelEngineView, "format" | "seats" | "result">): number[] {
  const result = engine.result;
  if (!result) return [];
  const format = engineFormat(engine);
  if (result.winnerTeam != null) {
    return engine.seats.filter((view) => seatTeam(format, view) === result.winnerTeam).map((view) => view.seat).sort((a, b) => a - b);
  }
  return result.winnerSeat == null ? [] : [result.winnerSeat];
}

export function winnerLabel(engine: Pick<DuelEngineView, "format" | "seats" | "result">, nameOf: (seat: number) => string): string | null {
  const seats = winnerSeats(engine);
  if (seats.length === 0) return null;
  return seats.map(nameOf).join(" and ");
}
