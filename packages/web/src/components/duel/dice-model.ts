import { DUEL_DICE_REVEAL_MS, type DuelDiceOpeningView, type DuelDiceRound } from "@yugidraft/shared/duels";

/**
 * What the dice opening of a 3-way or 4-way duel shows, as plain data. The server rolls every die, reveals a
 * round for 3 s and decides the order; this only turns the view and the clock into the screen to draw, so it
 * can be tested without React. Rolls are indexed by the LOBBY seat. Until the server's seat move the lobby seat
 * is also the public seat; in the `start` phase the names and the viewer's seat are already the moved ones.
 */

export const DICE_ORDINAL = ["1st", "2nd", "3rd", "4th"] as const;

/** Beats in ms from the start of a round. A round is one throw and lasts as long as the server shows it (3 s). */
export interface DiceTimeline {
  tumbleMin: number;
  tumbleMax: number;
  /** Largest random start delay between the dice of one round. */
  stagger: number;
  /** After the landing: extra wait before the landing effects (reduced motion fades in instead of tumbling). */
  land: number;
  /** A round that ends in a tie names the tied players here. */
  tieAt: number;
  /** The last round names the order here (every die has landed). */
  orderAt: number;
  /** The last round moves the players to their new seats here. */
  moveAt: number;
  moveMs: number;
}

export const DICE_TIMELINE: DiceTimeline = { tumbleMin: 1450, tumbleMax: 1800, stagger: 140, land: 0, tieAt: 2100, orderAt: 2000, moveAt: 2300, moveMs: 560 };
export const DICE_TIMELINE_REDUCED: DiceTimeline = { tumbleMin: 200, tumbleMax: 200, stagger: 0, land: 200, tieAt: 700, orderAt: 700, moveAt: 1300, moveMs: 200 };

export type DiceBeat = "rolling" | "tie" | "order";
export type DiceTileState = "rolling" | "landed" | "kept" | "tied";
export type DiceStatusKind = "plain" | "tie" | "win";

/** Epoch ms when the round on screen began. */
export function roundStartMs(view: DuelDiceOpeningView): number {
  return Date.parse(view.deadlineAt) - DUEL_DICE_REVEAL_MS;
}

export function currentRound(view: DuelDiceOpeningView): DuelDiceRound | null {
  return view.rounds.at(-1) ?? null;
}

export function seatCountOf(view: DuelDiceOpeningView): number {
  return view.rounds[0]?.rolls.length ?? view.order?.length ?? 0;
}

function hash(round: number, seat: number): number {
  let h = Math.imul(round * 7919 + seat * 104729 + 12345, 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

export interface DicePlan {
  delay: number;
  dur: number;
  /** Full turns to spin on each axis before the die lands, in degrees (signed). */
  spinX: number;
  spinY: number;
  spinZ: number;
}

/** How one die tumbles in one round. The same round and seat always give the same throw, on every screen. */
export function dicePlan(round: number, seat: number, timeline: DiceTimeline): DicePlan {
  const h = hash(round, seat);
  const f = (shift: number) => ((h >>> shift) & 255) / 255;
  const turns = (a: number, b: number) => (2 + (f(a) > 0.5 ? 1 : 0)) * 360 * (f(b) > 0.5 ? -1 : 1);
  return {
    delay: Math.round(f(0) * timeline.stagger),
    dur: Math.round(timeline.tumbleMin + f(8) * (timeline.tumbleMax - timeline.tumbleMin)),
    spinX: turns(16, 24),
    spinY: turns(3, 11),
    spinZ: Math.round(f(19) * 720 - 360),
  };
}

export function landsAt(plan: DicePlan, timeline: DiceTimeline): number {
  return plan.delay + plan.dur + timeline.land;
}

/** Seats that roll in this round: everyone in round 1, then only the players still tied. */
export function rollingSeats(round: DuelDiceRound): number[] {
  return round.rolls.flatMap((roll, seat) => (roll == null ? [] : [seat]));
}

/** The rank groups after the rounds, highest first. A group of two or more is still tied. */
export function replayGroups(rounds: readonly DuelDiceRound[], seatCount: number): number[][] {
  let groups: number[][] = [Array.from({ length: seatCount }, (_, seat) => seat)];
  for (const round of rounds) {
    groups = groups.flatMap((group) => {
      if (group.length === 1) return [group];
      const byRoll = new Map<number, number[]>();
      for (const seat of group) {
        const roll = round.rolls[seat];
        if (roll == null) return [group];
        byRoll.set(roll, [...(byRoll.get(roll) ?? []), seat]);
      }
      return [...byRoll.entries()].sort(([a], [b]) => b - a).map(([, seats]) => seats);
    });
  }
  return groups;
}

/** The tied players of the round on screen, as the groups that still share a rank. */
export function tiedGroups(view: DuelDiceOpeningView): number[][] {
  if (view.order) return [];
  return replayGroups(view.rounds, seatCountOf(view)).filter((group) => group.length > 1);
}

/**
 * After 10 tie rounds the server breaks the tied ranks with a random shuffle, so the final order arrives next
 * to rolls that are still tied.
 */
export function brokenAtRandom(view: DuelDiceOpeningView): boolean {
  if (!view.order) return false;
  return replayGroups(view.rounds, seatCountOf(view)).some((group) => group.length > 1);
}

export const RANDOM_BREAK_LINE = "Tie broken at random";

/** A seat's rolls so far, oldest first (a seat that kept its roll has fewer). */
export function rollPath(view: DuelDiceOpeningView, seat: number): number[] {
  return view.rounds.flatMap((round) => {
    const roll = round.rolls[seat];
    return roll == null ? [] : [roll];
  });
}

/** The face a seat's die shows: its latest roll. */
export function dieValue(view: DuelDiceOpeningView, seat: number): number {
  return rollPath(view, seat).at(-1) ?? 1;
}

/** The highest roll among the dice thrown in this round. */
export function topRoll(round: DuelDiceRound): number {
  return Math.max(0, ...rollingSeats(round).map((seat) => round.rolls[seat]!));
}

export type DiceLanding = "land" | "top" | "big";

/** The landing effect of a die: the top roll of the round flashes gold, and a 6 flashes brighter. */
export function landingOf(round: DuelDiceRound, seat: number): DiceLanding | null {
  const roll = round.rolls[seat];
  if (roll == null) return null;
  if (roll !== topRoll(round)) return "land";
  return roll === 6 ? "big" : "top";
}

export function rankOf(view: DuelDiceOpeningView, seat: number): number | null {
  const rank = view.order?.indexOf(seat) ?? -1;
  return rank < 0 ? null : rank;
}

/** The viewer's lobby seat. The final public seat is the rank, so a moved viewer maps back through the order. */
export function myLobbySeat(view: DuelDiceOpeningView, mySeat: number | null): number | null {
  if (mySeat == null) return null;
  if (view.phase === "start" && view.order) return view.order[mySeat] ?? null;
  return mySeat;
}

/** The public seat a player has now: the lobby seat, or the new one after the move. */
export function publicSeatOf(view: DuelDiceOpeningView, lobbySeat: number): number {
  return view.phase === "start" ? view.finalSeats?.[lobbySeat] ?? lobbySeat : lobbySeat;
}

/** Names come indexed by the current public seat. */
export function nameOfLobby(view: DuelDiceOpeningView, names: readonly string[], lobbySeat: number): string {
  return names[publicSeatOf(view, lobbySeat)] ?? `Player ${lobbySeat + 1}`;
}

/** Which beat of the round the clock is in. A round without a tie or an order only rolls. */
export function diceBeat(view: DuelDiceOpeningView, elapsed: number, timeline: DiceTimeline): DiceBeat {
  if (view.order) return elapsed >= timeline.orderAt || view.phase === "start" ? "order" : "rolling";
  return elapsed >= timeline.tieAt ? "tie" : "rolling";
}

/** True once the players stand in their new seats. */
export function seatsMoved(view: DuelDiceOpeningView, elapsed: number, timeline: DiceTimeline): boolean {
  return view.order != null && (view.phase === "start" || elapsed >= timeline.moveAt);
}

export interface DiceTile {
  seat: number;
  state: DiceTileState;
  value: number;
  /** The die throws in this round (it did not keep its roll). */
  rolling: boolean;
  /** Line one: the roll or what the die is doing. Line two: the roll before it. */
  caption: { main: string; note: string | null };
  chip: { text: string; kind: "tie" | "rank"; first: boolean } | null;
  rank: number | null;
}

export function tileOf(view: DuelDiceOpeningView, seat: number, elapsed: number, timeline: DiceTimeline): DiceTile {
  const round = currentRound(view);
  const rolling = round != null && round.rolls[seat] != null;
  const beat = diceBeat(view, elapsed, timeline);
  const path = rollPath(view, seat);
  const value = dieValue(view, seat);
  const rank = rankOf(view, seat);
  const landed = !rolling || elapsed >= landsAt(dicePlan(view.round, seat, timeline), timeline);
  const rolled = { main: `Rolled ${value}`, note: path.length > 1 ? `was ${path.at(-2)}` : null };
  const base = { seat, value, rolling, rank };
  if (beat === "order" && rank != null) {
    return { ...base, state: "landed", caption: rolled, chip: { text: DICE_ORDINAL[rank] ?? `${rank + 1}th`, kind: "rank", first: rank === 0 } };
  }
  if (beat === "tie") {
    const tied = tiedGroups(view).some((group) => group.includes(seat));
    if (tied) return { ...base, state: "tied", caption: rolled, chip: { text: "Tie", kind: "tie", first: false } };
    return { ...base, state: "kept", caption: { main: `Keeps ${value}`, note: null }, chip: null };
  }
  if (!rolling) return { ...base, state: "kept", caption: { main: `Keeps ${value}`, note: null }, chip: null };
  if (!landed) return { ...base, state: "rolling", caption: { main: "Rolling…", note: null }, chip: null };
  return { ...base, state: "landed", caption: rolled, chip: null };
}

/** "You", "You and Mira" or "Mira, Dax and Rin": the viewer first. */
export function nameList(seats: readonly number[], me: number | null, nameOf: (seat: number) => string): string {
  const labels = [...seats].sort((a, b) => (a === me ? -1 : b === me ? 1 : a - b)).map((seat) => (seat === me ? "You" : nameOf(seat)));
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export interface DiceStatus {
  main: string;
  note: string;
  kind: DiceStatusKind;
}

/** The line under the title. `moved` adds the seat line to the order note. */
export function diceStatus(view: DuelDiceOpeningView, me: number | null, nameOf: (seat: number) => string, beat: DiceBeat, moved: boolean): DiceStatus {
  const round = currentRound(view);
  if (beat === "order" && view.order) {
    const first = view.order[0]!;
    const main = first === me ? "You go first" : `${nameOf(first)} goes first`;
    const order = `Turn order: ${view.order.map((seat) => (seat === me ? "You" : nameOf(seat))).join(" → ")}`;
    const note = moved ? seatLine(view, me, nameOf) : order;
    return { main, note: brokenAtRandom(view) ? `${RANDOM_BREAK_LINE} · ${note}` : note, kind: "win" };
  }
  if (beat === "tie" && round) {
    const note = tiedGroups(view)
      .map((group) => `${nameList(group, me, nameOf)} tied on ${dieValue(view, group[0]!)}`)
      .join(" · ");
    return { main: "Tie — roll again", note, kind: "tie" };
  }
  if (view.round > 1) return { main: "Rolling again…", note: "Only the tied players roll", kind: "plain" };
  return { main: "Rolling…", note: "Everyone rolls at once", kind: "plain" };
}

/** Where the seats stand after the move: the 3-way follows the order; the 4-way pairs rank 1+2 and 3+4. */
export function seatLine(view: DuelDiceOpeningView, me: number | null, nameOf: (seat: number) => string): string {
  const order = view.order;
  if (!order) return "";
  if (order.length < 4) return "Seats follow the turn order";
  if (me != null) {
    const facing = facingSeat(view, me);
    return facing == null ? "" : `You face ${nameOf(facing)}`;
  }
  return `${nameOf(order[0]!)} faces ${nameOf(order[1]!)} · ${nameOf(order[2]!)} faces ${nameOf(order[3]!)}`;
}

/** The lobby seat across the table from `seat` after the move (4-way only): rank 1 faces 2, rank 3 faces 4. */
export function facingSeat(view: DuelDiceOpeningView, seat: number): number | null {
  const order = view.order;
  if (!order || order.length < 4) return null;
  const rank = order.indexOf(seat);
  return rank < 0 ? null : order[rank ^ 1] ?? null;
}

/** "Moves to seat 2" or "Stays in seat 1": for the player's accessible label once the order is known. */
export function seatMoveText(view: DuelDiceOpeningView, lobbySeat: number): string | null {
  const to = view.order?.indexOf(lobbySeat) ?? -1;
  if (to < 0) return null;
  return to === lobbySeat ? `Stays in seat ${to + 1}` : `Moves to seat ${to + 1}`;
}

/** The small line under the title. */
export function diceSub(view: DuelDiceOpeningView, me: number | null, moved: boolean): string {
  const n = seatCountOf(view);
  const parts = [`${n}-way`];
  if (me == null) parts.push("You are watching");
  if (moved) parts.push("Seats in turn order");
  else {
    parts.push(`Round ${view.round}`);
    if (view.round > 1) parts.push("tied players only");
  }
  return parts.join(" · ");
}
