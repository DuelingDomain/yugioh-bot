// Which cards of an open pile (Graveyard, Banished, Extra Deck) are part of the chain right now.
// Pure model: no React state, no DOM. The pile viewer draws the result.
//
// The field badge finds its card by the zone the link activated from (`link.zone`: controller, location,
// sequence). A pile card has the same three numbers (its sequence is its place in the pile, 0 = the bottom),
// so the viewer uses the same key. That marks the right copy when a pile holds two cards of the same name.
//
// The zone on a link is the place at activation. A pile renumbers when a card below leaves it (or enters it below),
// so `followChainZones` replays the `move` events after the activation and keeps the zone on the same card.
import { useMemo } from "react";
import type { DuelCard, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DECK, LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_HAND, LOCATION_REMOVED } from "./constants";
import { deriveChainState, type ChainLinkState } from "./chain-state";

/** One chain link on a pile card, in the words the viewer prints. */
export interface PileChainMark {
  /** Chain Link number, 1 = the first activation. */
  index: number;
  status: ChainLinkState["status"];
  negated: boolean;
  /** "activating", "resolving" or "negated". */
  phase: "activating" | "resolving" | "negated";
  /** "Chain 1 · resolving" */
  label: string;
  /** "Chain link 1", the accessible name of the badge. */
  ariaLabel: string;
}

/** A link that was activated but has not resolved yet. A resolved link no longer marks its card. */
function isOpen(link: ChainLinkState): boolean {
  return link.status !== "resolved";
}

function markOf(link: ChainLinkState): PileChainMark {
  const phase = link.negated ? "negated" : link.status === "resolving" ? "resolving" : "activating";
  return {
    index: link.index,
    status: link.status,
    negated: link.negated,
    phase,
    label: `Chain ${link.index} · ${phase}`,
    ariaLabel: `Chain link ${link.index}`,
  };
}

/**
 * Whether `card` is the card the link activated from. The zone must match exactly. A card whose code is public must
 * also match the code of the link, when the link has one: a pile that shifted under the chain never marks a stranger.
 */
function isLinkCard(card: DuelCard, link: ChainLinkState): boolean {
  const zone = link.zone;
  if (!zone) return false;
  if (card.controller !== zone.controller || card.location !== zone.location || card.sequence !== zone.sequence) return false;
  return link.code == null || card.code == null || card.code === link.code;
}

/**
 * The chain marks of each card of a pile, keyed by the card's place in `cards` (engine order). A card that is no
 * link's card has no entry. A card that several links activated from (an effect that chains to itself) has them all,
 * lowest link first.
 */
export function pileChainMarks(links: readonly ChainLinkState[], cards: readonly DuelCard[]): ReadonlyMap<number, readonly PileChainMark[]> {
  const out = new Map<number, PileChainMark[]>();
  if (links.length === 0 || cards.length === 0) return out;
  for (const link of links) {
    if (!link.zone || !isOpen(link)) continue;
    const at = cards.findIndex((card) => isLinkCard(card, link));
    if (at < 0) continue;
    const marks = out.get(at) ?? [];
    marks.push(markOf(link));
    out.set(at, marks);
  }
  for (const marks of out.values()) marks.sort((a, b) => a.index - b.index);
  return out;
}

/** "Chain 1 · resolving" for a card, or "Chain 1 · activating, Chain 2 · activating" when it holds two links. */
export function chainMarkLabel(marks: readonly PileChainMark[]): string {
  return marks.map((mark) => mark.label).join(", ");
}

/** Piles and the hand are lists: a card that leaves closes the gap, a card that arrives opens one (as the server's target tracking does). */
const isList = (location: number): boolean => (location & (LOCATION_DECK | LOCATION_HAND | LOCATION_GRAVE | LOCATION_REMOVED | LOCATION_EXTRA)) !== 0;
const sameList = (zone: DuelZoneRef, other: DuelZoneRef): boolean => zone.controller === other.controller && zone.location === other.location;
const sameZone = (zone: DuelZoneRef, other: DuelZoneRef): boolean => sameList(zone, other) && zone.sequence === other.sequence;

/** Where a card that sat in `zone` is after one `move` event: its destination, or its old place closed up or pushed along. */
function afterMove(zone: DuelZoneRef, event: DuelEvent): DuelZoneRef | null {
  const { from, zone: to } = event;
  if (!from) return zone;
  if (sameZone(zone, from)) return to ? { ...to } : null;
  let sequence = zone.sequence;
  if (isList(from.location) && sameList(zone, from) && sequence > from.sequence) sequence -= 1;
  if (to && isList(to.location) && sameList(zone, to) && sequence >= to.sequence) sequence += 1;
  return sequence === zone.sequence ? zone : { ...zone, sequence };
}

/**
 * The links with their zone kept on the card that activated. The zone of a link is where the card was at activation;
 * every `move` event after that activation (a card below it leaving the GY, banishing as a cost, a card sent under
 * it) renumbers the pile, so the events are replayed on it. When the event window no longer holds the activation
 * (a reload mid-chain), or the activation zone is not the one on the link, the link keeps its exact zone.
 */
export function followChainZones(links: readonly ChainLinkState[], events: readonly DuelEvent[]): readonly ChainLinkState[] {
  if (links.length === 0 || events.length === 0) return links;
  const ordered = events.filter((event) => event.kind === "activate" || event.kind === "move").sort((a, b) => a.id - b.id);
  return links.map((link) => {
    if (!link.zone) return link;
    let activation: DuelEvent | undefined;
    for (const event of ordered) if (event.kind === "activate" && event.chainIndex === link.index) activation = event;
    if (!activation?.zone || !sameZone(activation.zone, link.zone)) return link;
    let zone: DuelZoneRef | null = link.zone;
    for (const event of ordered) {
      if (event.id <= activation.id || event.kind !== "move") continue;
      zone = afterMove(zone, event);
      if (!zone) break;
    }
    // A card that left the board entirely (a move without a destination) has no zone: no pile marks it.
    return zone === link.zone ? link : { ...link, zone };
  });
}

/**
 * The chain as the engine holds it now (events plus the snapshot), for the pile viewer. It follows the live chain
 * the way the target rings do, so a card is marked from the activation and unmarked at "chain-end". `ended` (the duel
 * is over) clears it, as the chain overlay does.
 */
export function useLiveChainLinks(events: readonly DuelEvent[], snapshot: readonly DuelChainLink[], ended = false): readonly ChainLinkState[] {
  return useMemo(() => (ended ? [] : followChainZones(deriveChainState(events, snapshot).links, events)), [events, snapshot, ended]);
}
