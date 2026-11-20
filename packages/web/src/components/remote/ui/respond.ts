import { REMOTE_RESPOND_COOLDOWN_MS, remoteOpeningPending, type RemoteEvent, type RemoteState } from "@yugidraft/shared/remote";

/** How long a response is shown, and how long the turn player's phase and turn changes wait for it. */
export const RESPOND_HOLD_MS = 4000;

export type RespondHold = { eventId: string; seat: number; until: number };

/** The newest response that is still holding, from the room events. `now` is on the server clock (serverNow), like `event.at`. */
export function activeRespond(events: readonly RemoteEvent[], now: number): RespondHold | null {
  const event = events.findLast(item => item.action.type === "chain.respond");
  if (!event || event.actorSeat === null) return null;
  const until = event.at + RESPOND_HOLD_MS;
  return until > now ? { eventId: event.id, seat: event.actorSeat, until } : null;
}

/** The response that holds this spoken line, if any: only phase and turn lines wait. The responder's own lines never wait for their own response. */
export const heldByResponse = (intent: { kind: string }, events: readonly RemoteEvent[], now: number, me: number | null): RespondHold | null => {
  if (intent.kind !== "phase" && intent.kind !== "turn") return null;
  const hold = activeRespond(events, now);
  return hold && hold.seat !== me ? hold : null;
};

/** True while this seat's last response is newer than the server cooldown; the server refuses another one. */
export const respondCoolingDown = (events: readonly RemoteEvent[], seat: number | null, now: number): boolean => {
  const last = events.findLast(item => item.action.type === "chain.respond" && item.actorSeat === seat);
  return !!last && seat !== null && last.at + REMOTE_RESPOND_COOLDOWN_MS > now;
};

/** A response needs a live duel: not the die roll or first-player choice, not siding, not a finished game, and a seat still in it. */
export const mayRespond = (state: RemoteState, seat: number): boolean =>
  !state.ended && state.match.phase === "duel" && !remoteOpeningPending(state.match) && seat >= 0 && !state.seats[seat]?.eliminated;
