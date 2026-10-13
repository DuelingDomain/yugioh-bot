// Which cards of an open pile (Graveyard, Banished, Extra Deck) are part of the chain right now.
// Pure model: no React state, no DOM. The pile viewer draws the result.
//
// The field badge finds its card by the zone the link activated from (`link.zone`: controller, location,
// sequence). A pile card has the same three numbers (its sequence is its place in the pile, 0 = the bottom),
// so the viewer uses the same key. That marks the right copy when a pile holds two cards of the same name.
import { useMemo } from "react";
import type { DuelCard, DuelChainLink, DuelEvent } from "@yugidraft/shared/duels";
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

/**
 * The chain as the engine holds it now (events plus the snapshot), for the pile viewer. It follows the live chain
 * the way the target rings do, so a card is marked from the activation and unmarked at "chain-end". `ended` (the duel
 * is over) clears it, as the chain overlay does.
 */
export function useLiveChainLinks(events: readonly DuelEvent[], snapshot: readonly DuelChainLink[], ended = false): readonly ChainLinkState[] {
  return useMemo(() => (ended ? [] : deriveChainState(events, snapshot).links), [events, snapshot, ended]);
}
