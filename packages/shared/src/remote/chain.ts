import type { RemoteEvent, RemoteState } from "./types.js";

export const REMOTE_CHAIN_GAP_MS = 30_000;
export const REMOTE_CHAIN_EVENT_WINDOW = 50;
/** Moves soon after the last activation can be part of its cost or effect. */
const ACTIVATION_COST_MS = 3000;

/** Events that move the game on: Thinking and an open chain end here for everyone. A new game and the end of the table are in it. */
export const REMOTE_CHAIN_MOVES_ON = new Set<string>(["phase.set", "phase.advance", "turn.end", "table.started", "match.first", "table.ended"]);

export function remoteUndoneActionIds(events: readonly RemoteEvent[]): Set<string> {
  const undone = new Set<string>();
  for (const { action } of events) if (action.type === "undo") {
    undone.add(action.targetActionId);
    for (const id of action.alsoUndid ?? []) undone.add(id);
  }
  return undone;
}

export function remoteEventsWithoutUndo(events: readonly RemoteEvent[]): RemoteEvent[] {
  const undone = remoteUndoneActionIds(events);
  return events.filter(event => event.action.type !== "undo" && !undone.has(event.id));
}

export type ChainLink = { n: number; of?: RemoteEvent };

/** Actions that move the game on: a chain does not reach across them. */
const CLOSERS = new Set([...REMOTE_CHAIN_MOVES_ON, "attack.declare", "attack.resolve", "lp.change", "player.concede", "player.leave"]);

/**
 * An activation by another seat while the last activation is still open is the next link of its chain.
 * A chain stays open until every other living seat said OK, the game moved on (phase, turn, attack, LP, new play) or 30 s pass.
 * `alive` are the seats still in the game.
 */
export function remoteChainOf(events: readonly RemoteEvent[], alive: readonly number[]): { links: Map<string, ChainLink>; open: RemoteEvent[] } {
  const links = new Map<string, ChainLink>();
  let open: RemoteEvent[] = []; let oked = new Set<number>();
  for (const event of remoteEventsWithoutUndo(events)) {
    const action = event.action; const seat = event.actorSeat;
    if (action.type === "effect.activated" && seat !== null) {
      const last = open[open.length - 1];
      const chained = !!last && last.actorSeat !== seat && event.at - last.at < REMOTE_CHAIN_GAP_MS &&
        (!action.respondsTo || action.respondsTo === last.id);
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

export const remoteAliveSeats = (state: RemoteState): number[] => state.seats.filter(seat => !seat.eliminated).map(seat => seat.seat);

export function openRemoteChainLink(events: readonly RemoteEvent[], alive: readonly number[], seat: number, now: number) {
  if (!alive.includes(seat)) return;
  const chain = remoteChainOf(events, alive), event = chain.open.at(-1);
  if (!event || event.actorSeat === seat || now - event.at >= REMOTE_CHAIN_GAP_MS) return;
  return { event, n: chain.links.get(event.id)!.n, expiresAt: event.at + REMOTE_CHAIN_GAP_MS };
}
