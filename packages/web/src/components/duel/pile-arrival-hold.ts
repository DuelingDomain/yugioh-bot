import { hideElement } from "./hide-element";

/**
 * A Graveyard or banished pile shows its top three cards as a fan (`data-fi`, 0 = newest). When several cards are
 * flying into one pile, each real card must stay hidden until its own flight lands: each flight holds its own place in
 * the fan, and a landing shows that card only, whatever the landing order. The fan is redrawn when later payloads add cards (new
 * nodes), so the hidden set is applied again after every change in the page.
 */

const FAN_SIZE = 3;

/** `slot` = how many cards were added to the pile after this one (its fan index while it flies). */
type Hold = { dest: () => HTMLElement | null; slot: number };
type Pile = { holds: Hold[]; hidden: HTMLElement[]; release: () => void };

const piles = new Map<string, Pile>();
let observer: MutationObserver | null = null;
let queued = false;

function apply(pile: Pile) {
  const dest = pile.holds[pile.holds.length - 1]?.dest() ?? null;
  const want: HTMLElement[] = [];
  if (dest) {
    for (const hold of pile.holds) {
      const node = hold.slot < FAN_SIZE ? dest.querySelector<HTMLElement>(`[data-fi="${hold.slot}"]`) : null;
      if (node) want.push(node);
    }
  }
  if (want.length === pile.hidden.length && want.every((node, index) => node === pile.hidden[index] && node.isConnected)) return;
  pile.release();
  const releases = want.map(hideElement);
  pile.hidden = want;
  pile.release = () => releases.forEach((release) => release());
}

function applyAll() {
  queued = false;
  for (const pile of piles.values()) apply(pile);
}

function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(applyAll);
}

/**
 * Holds the card of one flight at its place in the pile (the newest card on top, each later arrival pushes it one
 * place down) until the returned function is called. A landing shows its own card only, in any landing order.
 */
export function beginPileArrivalHold(pileKey: string, dest: () => HTMLElement | null): () => void {
  let pile = piles.get(pileKey);
  if (!pile) {
    pile = { holds: [], hidden: [], release: () => {} };
    piles.set(pileKey, pile);
  }
  for (const other of pile.holds) other.slot += 1;
  const hold: Hold = { dest, slot: 0 };
  pile.holds.push(hold);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  apply(pile);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = piles.get(pileKey);
    if (!current) return;
    current.holds = current.holds.filter((item) => item !== hold);
    apply(current);
    if (current.holds.length === 0) {
      current.release();
      piles.delete(pileKey);
      if (piles.size === 0) {
        observer?.disconnect();
        observer = null;
      }
    }
  };
}
