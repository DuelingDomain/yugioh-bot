import { hideElement } from "./hide-element";

/**
 * A Graveyard or banished pile shows its top three cards as a fan (`data-fi`, 0 = newest). When several cards are
 * flying into one pile, each real card must stay hidden until its own flight lands: with n cards on the way the top n
 * fan cards wait, and each landing shows the oldest of them. The fan is redrawn when later payloads add cards (new
 * nodes), so the hidden set is applied again after every change in the page.
 */

const FAN_SIZE = 3;

type Hold = { dest: () => HTMLElement | null };
type Pile = { holds: Hold[]; hidden: HTMLElement[]; release: () => void };

const piles = new Map<string, Pile>();
let observer: MutationObserver | null = null;
let queued = false;

function fanNodes(dest: HTMLElement, count: number): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  for (let fi = 0; fi < Math.min(count, FAN_SIZE); fi += 1) {
    const node = dest.querySelector<HTMLElement>(`[data-fi="${fi}"]`);
    if (node) nodes.push(node);
  }
  return nodes;
}

function apply(pile: Pile) {
  const latest = pile.holds[pile.holds.length - 1];
  const dest = latest?.dest() ?? null;
  const want = dest ? fanNodes(dest, pile.holds.length) : [];
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

/** Holds the newest fan card of a pile (one more per call) until the returned function is called. */
export function beginPileArrivalHold(pileKey: string, dest: () => HTMLElement | null): () => void {
  let pile = piles.get(pileKey);
  if (!pile) {
    pile = { holds: [], hidden: [], release: () => {} };
    piles.set(pileKey, pile);
  }
  const hold: Hold = { dest };
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
