import type { RemoteEvent } from "@yugidraft/shared/remote";

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

/** The response that holds this spoken line, if any: only phase and turn lines wait. */
export const heldByResponse = (intent: { kind: string }, events: readonly RemoteEvent[], now: number): RespondHold | null =>
  intent.kind === "phase" || intent.kind === "turn" ? activeRespond(events, now) : null;
