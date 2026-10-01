// Pure chain state for the duel board. No React, no DOM.
//
// The engine sends a rolling window of DuelEvent plus a snapshot `chain` (index, seat, code, name).
// Chain events are public: an "activate" with a chainIndex opens link N (card, controller and the
// zone it activated from), "chain-resolving" / "chain-resolved" / "chain-negated" move that link
// through its life (highest link first), and "chain-end" clears the chain.
//
// applyChainEvent folds one event into the state, so a player can play a batch out one beat at a
// time. deriveChainState folds a whole window at once (first paint, reconnect, replay of a window).
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DECK, LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_HAND, LOCATION_REMOVED, zoneKey } from "./constants";

export type ChainLinkStatus = "pending" | "resolving" | "resolved";

export interface ChainLinkState {
  /** Chain Link number, 1 = the first activation. */
  index: number;
  seat: number;
  /** null when the activation left the event window and the snapshot has no card either. */
  code: number | null;
  name: string | null;
  card: DuelCardInfo | null;
  description?: string;
  /** Where the card was when it activated (hand slot, field zone, pile card, ...). null when unknown. */
  zone: DuelZoneRef | null;
  status: ChainLinkStatus;
  /** Negated or disabled. Stays set after the link resolves. */
  negated: boolean;
}

export interface ChainState {
  /** Ordered by index, links[0] is Chain Link 1. */
  links: ChainLinkState[];
  /** The link that is resolving right now, null between links and while the chain is still building. */
  resolving: number | null;
}

export const EMPTY_CHAIN: ChainState = { links: [], resolving: null };

type ChainEventKind = "activate" | "chain-resolving" | "chain-resolved" | "chain-negated" | "chain-end";

/** True for an event that changes the chain. A plain "activate" without a chainIndex is not one. */
export function isChainEvent(event: DuelEvent): boolean {
  if (event.kind === "chain-end") return true;
  if (event.kind === "activate" || event.kind === "chain-resolving" || event.kind === "chain-resolved" || event.kind === "chain-negated") {
    return typeof event.chainIndex === "number" && event.chainIndex >= 1;
  }
  return false;
}

function placeholder(index: number): ChainLinkState {
  return { index, seat: 0, code: null, name: null, card: null, zone: null, status: "pending", negated: false };
}

/** Links 1..index, adding placeholders for any the window lost. Does not copy existing links. */
function ensureLinks(links: ChainLinkState[], index: number): ChainLinkState[] {
  if (links.length >= index) return links.slice();
  const next = links.slice();
  for (let i = links.length + 1; i <= index; i += 1) next.push(placeholder(i));
  return next;
}

export function applyChainEvent(state: ChainState, event: DuelEvent): ChainState {
  if (!isChainEvent(event)) return state;
  const kind = event.kind as ChainEventKind;
  if (kind === "chain-end") return EMPTY_CHAIN;
  const index = event.chainIndex as number;

  if (kind === "activate") {
    // Link N replaces anything from N up: a new chain restarts at 1, a repeated activation is idempotent.
    const kept = state.links.slice(0, index - 1);
    const links = ensureLinks(kept, index - 1);
    const card = event.card ?? null;
    links.push({
      index,
      seat: event.seat ?? 0,
      code: card && card.code > 0 ? card.code : null,
      name: card?.name ?? null,
      card,
      description: event.description,
      zone: event.zone ? { ...event.zone } : null,
      status: "pending",
      negated: false,
    });
    return { links, resolving: null };
  }

  const links = ensureLinks(state.links, index);
  const link = { ...links[index - 1] };
  links[index - 1] = link;
  if (kind === "chain-resolving") {
    link.status = "resolving";
    if (event.seat != null && link.code == null) link.seat = event.seat;
    return { links, resolving: index };
  }
  if (kind === "chain-resolved") {
    link.status = "resolved";
    return { links, resolving: state.resolving === index ? null : state.resolving };
  }
  link.negated = true;
  return { links, resolving: state.resolving };
}

function fromSnapshot(link: DuelChainLink): ChainLinkState {
  return {
    index: link.index,
    seat: link.seat,
    code: link.code != null && link.code > 0 ? link.code : null,
    name: link.name ?? null,
    card: null,
    description: link.description,
    zone: null,
    status: "pending",
    negated: false,
  };
}

/**
 * The chain after a whole event window. The snapshot chain fills links the window no longer holds
 * (and is the whole chain when the window has none), so a reload mid-chain still shows it.
 */
export function deriveChainState(events: readonly DuelEvent[], snapshot: readonly DuelChainLink[] = []): ChainState {
  const ordered = events.filter(isChainEvent).sort((a, b) => a.id - b.id);
  let state = ordered.reduce(applyChainEvent, EMPTY_CHAIN);
  if (state === EMPTY_CHAIN && ordered.length > 0 && ordered[ordered.length - 1].kind === "chain-end") return EMPTY_CHAIN;
  if (snapshot.length === 0) return state;
  if (state.links.length === 0) return { links: snapshot.map(fromSnapshot), resolving: null };
  let links: ChainLinkState[] | null = null;
  for (const link of snapshot) {
    const current = (links ?? state.links)[link.index - 1];
    if (current && current.code != null) continue;
    links ??= state.links.slice();
    while (links.length < link.index) links.push(placeholder(links.length + 1));
    const filled = fromSnapshot(link);
    const known = links[link.index - 1];
    links[link.index - 1] = { ...filled, status: known.status, negated: known.negated, zone: known.zone };
  }
  if (links) state = { links, resolving: state.resolving };
  return state;
}

/**
 * The stack panel shows a chain of two or more links, or a lone link that has not started
 * resolving (somebody is still deciding on a response).
 */
export function chainPanelVisible(state: ChainState): boolean {
  if (state.links.length >= 2) return true;
  return state.links.length === 1 && state.links[0].status === "pending";
}

/** Reading order for the stack panel: the top of the chain first, Chain Link 1 at the bottom. */
export function panelOrder(state: ChainState): ChainLinkState[] {
  return state.links.slice().sort((a, b) => b.index - a.index);
}

export type ChainAnchor = {
  /** The zone the card activated from; on the board it is found by its data-zones key. */
  zone: DuelZoneRef;
  /** Used when that exact slot is gone (the card left it): the whole hand or pile of that player. */
  fallback?: { kind: "hand"; controller: number } | { kind: "pile"; controller: number; location: number };
};

const PILES = new Set<number>([LOCATION_GRAVE, LOCATION_REMOVED, LOCATION_EXTRA, LOCATION_DECK]);

/** Where the board puts a link's badge, or null when the activation zone is unknown (stack panel only). */
export function chainAnchor(link: ChainLinkState): ChainAnchor | null {
  const zone = link.zone;
  if (!zone) return null;
  if (zone.location === LOCATION_HAND) return { zone, fallback: { kind: "hand", controller: zone.controller } };
  if (PILES.has(zone.location)) {
    return { zone, fallback: { kind: "pile", controller: zone.controller, location: zone.location } };
  }
  return { zone };
}

/** The data-zones key of an anchor's zone. */
export function anchorKey(anchor: ChainAnchor): string {
  return zoneKey(anchor.zone.controller, anchor.zone.location, anchor.zone.sequence);
}

/** "You" / "Opponent" for a seated player, the player name for a spectator. */
export function chainSeatLabel(seat: number, mySeat: number | null, playerName: (seat: number) => string): string {
  if (mySeat == null) return playerName(seat);
  return seat === mySeat ? "You" : "Opponent";
}

const STEP_MS: Record<ChainEventKind, number> = {
  activate: 700,
  "chain-resolving": 800,
  "chain-resolved": 380,
  "chain-negated": 520,
  "chain-end": 480,
};
const STEP_FLOOR_MS = 240;
/** A backlog of more than this many beats is played faster, down to the floor. */
const BACKLOG_BEATS = 6;

/** How long to hold the board on a chain event before the next one plays. */
export function chainStepDelay(kind: string, remaining: number, reducedMotion: boolean): number {
  const base = STEP_MS[kind as ChainEventKind] ?? 400;
  const length = reducedMotion ? Math.max(STEP_FLOOR_MS, Math.round(base * 0.8)) : base;
  if (remaining <= BACKLOG_BEATS) return length;
  return Math.max(STEP_FLOOR_MS, Math.round((length * BACKLOG_BEATS) / remaining));
}

/** Cheap equality key: two states with the same key draw the same board. */
export function chainStateKey(state: ChainState): string {
  return state.links
    .map((link) => {
      const z = link.zone ? zoneKey(link.zone.controller, link.zone.location, link.zone.sequence) : "-";
      return `${link.index}:${link.seat}:${link.code ?? 0}:${link.status}:${link.negated ? 1 : 0}:${z}`;
    })
    .join("|");
}
