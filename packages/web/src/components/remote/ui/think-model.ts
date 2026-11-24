import type { RemoteEvent, RemoteState } from "@yugidraft/shared/remote";
import { cardCode, type TwinCard } from "./model";

/** How long the short "OK" shows on every screen. */
export const OK_HOLD_MS = 1500;
/** A card placed in the last ten seconds is the one "E" means when nothing is under the pointer. */
export const RECENT_PLACE_MS = 10_000;
/** Two activations further apart than this are not one chain. Thinking has no limit; only the chain display forgets. */
export const CHAIN_GAP_MS = 30_000;
/** Moves this soon after an activation are its costs and effects; later ones are new play and close the chain display. */
const ACTIVATION_COST_MS = 3000;
/** The room sends the newest 50 events. Thinking whose start has left that window is off, so a reloaded screen and a live one agree. */
export const EVENT_WINDOW = 50;

const FIELD = new Set(["monster", "extra-monster", "spell-trap", "field", "pendulum"]);
export const onField = (card: Pick<TwinCard, "zone">) => FIELD.has(card.zone);

/** Events that move the game on: Thinking and an open chain end here for everyone. A new game and the end of the table are in it. */
const MOVES_ON = new Set<string>(["phase.set", "phase.advance", "turn.end", "table.started", "match.first", "table.ended"]);

/**
 * Seats that are thinking now, with the server time they started. Thinking ends at OK, an activation, a response, a cancel, a leave,
 * or when the game moves on (phase, turn, new game, table end). `live` is false when the game is over or between games: nobody thinks then.
 */
export function thinkingSeats(events: readonly RemoteEvent[], live = true): Map<number, number> {
  const seats = new Map<number, number>();
  if (!live) return seats;
  const floor = (events.at(-1)?.seq ?? 0) - EVENT_WINDOW;
  for (const event of events) {
    if (event.seq <= floor) continue;
    const action = event.action; const seat = event.actorSeat;
    if (MOVES_ON.has(action.type)) { seats.clear(); continue; }
    if (seat === null) continue;
    if (action.type === "chain.thinking") { if (action.on) { if (!seats.has(seat)) seats.set(seat, event.at); } else seats.delete(seat); }
    else if (action.type === "chain.ok" || action.type === "chain.respond" || action.type === "effect.activated" || action.type === "player.concede" || action.type === "player.leave") seats.delete(seat);
  }
  return seats;
}

export type OkHold = { eventId: string; seat: number; until: number };
/** The newest OK that still shows. `now` is on the server clock, like `event.at`. */
export function activeOk(events: readonly RemoteEvent[], now: number): OkHold | null {
  const event = events.findLast(item => item.action.type === "chain.ok");
  if (!event || event.actorSeat === null) return null;
  const until = event.at + OK_HOLD_MS;
  return until > now ? { eventId: event.id, seat: event.actorSeat, until } : null;
}

export type ChainLink = { n: number; of?: RemoteEvent };

/** Actions that move the game on: a chain does not reach across them. */
const CLOSERS = new Set([...MOVES_ON, "attack.declare", "attack.resolve", "lp.change", "undo", "player.concede", "player.leave"]);

/**
 * Display only, no rules engine. An activation by another seat while the last activation is still open is the next link of its chain.
 * A chain stays open until every other living seat said OK, the game moved on (phase, turn, attack, LP, undo, new play) or 30 s pass.
 * `alive` are the seats still in the game.
 */
export function chainOf(events: readonly RemoteEvent[], alive: readonly number[]): { links: Map<string, ChainLink>; open: RemoteEvent[] } {
  const links = new Map<string, ChainLink>();
  let open: RemoteEvent[] = []; let oked = new Set<number>();
  for (const event of events) {
    const action = event.action; const seat = event.actorSeat;
    if (action.type === "effect.activated" && seat !== null) {
      const last = open[open.length - 1];
      const chained = !!last && last.actorSeat !== seat && event.at - last.at <= CHAIN_GAP_MS;
      if (!chained) open = [];
      open.push(event); oked = new Set();
      links.set(event.id, { n: open.length, ...(chained ? { of: last } : {}) });
    } else if (action.type === "chain.ok" && seat !== null && open.length) {
      oked.add(seat);
      const starter = open[open.length - 1].actorSeat;
      if (alive.every(other => other === starter || oked.has(other))) open = [];
    } else if (CLOSERS.has(action.type)) open = [];
    else if ((action.type === "twin.place" || action.type === "twin.move") && action.source !== "auto" && open.length) {
      // A placement or move by the player who activated last, a few seconds later, is new play, not a cost of that activation.
      const last = open[open.length - 1];
      if (seat === last.actorSeat && event.at - last.at > ACTIVATION_COST_MS) open = [];
    }
  }
  return { links, open };
}

export const aliveSeats = (state: RemoteState): number[] => state.seats.filter(seat => !seat.eliminated).map(seat => seat.seat);

/** The card a player means with a plain E press, step (b): their newest placement in the last ten seconds that is still on the field and not yet activated. */
export function recentlyPlaced(events: readonly RemoteEvent[], state: RemoteState, seat: number, now: number): TwinCard | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]; const action = event.action;
    if (now - event.at > RECENT_PLACE_MS) return undefined;
    if (event.actorSeat !== seat) continue;
    if (action.type === "effect.activated") return undefined;
    let ref: string | undefined;
    if (action.type === "twin.place" && !action.give && action.seat === seat) ref = action.card.ref;
    else if ((action.type === "twin.move" || action.type === "twin.flip") && action.seat === seat) ref = action.cardRef;
    if (!ref) continue;
    const card = state.seats[seat]?.twin.find(item => item.ref === ref);
    if (card && onField(card) && cardCode(card)) return card;
  }
  return undefined;
}

/** Step (c): my face-up field cards that can be activated, at most nine, in zone order. */
export const activatable = (state: RemoteState, seat: number): TwinCard[] =>
  (state.seats[seat]?.twin ?? []).filter(card => onField(card) && card.faceUp !== false && cardCode(card)).slice(0, 9);
