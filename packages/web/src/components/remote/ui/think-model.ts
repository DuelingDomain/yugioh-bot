import { remoteFirstPending, REMOTE_CHAIN_EVENT_WINDOW as EVENT_WINDOW, REMOTE_CHAIN_MOVES_ON as MOVES_ON, remoteEventsWithoutUndo as withoutUndoneEvents, type RemoteEvent, type RemoteState } from "@yugidraft/shared/remote";
import { cardCode, type TwinCard } from "./model";

/** How long the short "OK" shows on every screen. */
export const OK_HOLD_MS = 1500;
/** A card placed in the last ten seconds is the one "E" means when nothing is under the pointer. */
export const RECENT_PLACE_MS = 10_000;
export { REMOTE_CHAIN_GAP_MS as CHAIN_GAP_MS, remoteChainOf as chainOf, remoteAliveSeats as aliveSeats, type ChainLink } from "@yugidraft/shared/remote";

const FIELD = new Set(["monster", "extra-monster", "spell-trap", "field", "pendulum"]);
export const onField = (card: Pick<TwinCard, "zone">) => FIELD.has(card.zone);

/**
 * Seats that are thinking now, with the server time they started. Thinking ends at OK, an activation, a response, a cancel, a leave,
 * or when the game moves on (phase, turn, new game, table end). `live` is false when the game is over or between games: nobody thinks then.
 */
export function thinkingSeats(events: readonly RemoteEvent[], live = true): Map<number, number> {
  const seats = new Map<number, number>();
  if (!live) return seats;
  const floor = (events.at(-1)?.seq ?? 0) - EVENT_WINDOW;
  for (const event of withoutUndoneEvents(events)) {
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
  const event = withoutUndoneEvents(events).findLast(item => item.action.type === "chain.ok");
  if (!event || event.actorSeat === null) return null;
  const until = event.at + OK_HOLD_MS;
  return until > now ? { eventId: event.id, seat: event.actorSeat, until } : null;
}

/** The card a player means with a plain E press, step (b): their newest placement in the last ten seconds that is still on the field and not yet activated. */
export function recentlyPlaced(events: readonly RemoteEvent[], state: RemoteState, seat: number, now: number): TwinCard | undefined {
  const remaining = withoutUndoneEvents(events);
  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    const event = remaining[i]; const action = event.action;
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

/** Thinking, OK and a spoken line need a live duel: not the die roll or first-player choice, not siding, not a finished game, and a seat still in it. */
export const maySignal = (state: RemoteState, seat: number): boolean =>
  !state.ended && state.match.phase === "duel" && !remoteFirstPending(state.match) && seat >= 0 && !state.seats[seat]?.eliminated;
