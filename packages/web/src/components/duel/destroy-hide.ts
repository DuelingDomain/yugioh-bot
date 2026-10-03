import { duelFxClock } from "./fx-clock";
import { zoneKey } from "./constants";

/**
 * The destroy hand-off: a card that is being destroyed is "being destroyed" from the moment its
 * effect is planned until its flight lands in the Graveyard. The state is keyed by the zone it
 * leaves and its passcode (the board has no card ids).
 *
 *  - While it is set, the real card in the source zone is hidden at once: no intact card, no ATK/DEF
 *    plate and no zone glow under the cracks, the slice or the shards. The ghost of SummonFx and the
 *    pieces of MoveFx are what the player sees.
 *  - The Graveyard count is held one lower per card in flight, so the card is counted when it lands
 *    (the top card of the pile is hidden by MoveFx the same way).
 *  - Release is one call (the flight landed). Every hold also has a failsafe timer, so a stuck effect
 *    can never leave a zone empty or a count short.
 *
 * The plan and the state are plain data. The DOM part (`reconcileDestroyHides`) only reads the
 * zones by their `data-zones` key and the card art by its image address, and never removes a node.
 */

type Zone = { controller: number; location: number; sequence: number };

type CardHide = { id: string; zone: string; code: number };
type PileHold = { id: string; zone: string };

const cardHides = new Map<string, CardHide>();
const pileHolds = new Map<string, PileHold>();
const timers = new Map<string, number>();
/** Nodes hidden or rewritten by the last reconcile, so they can be put back. */
const hiddenNodes = new Set<HTMLElement>();
const countNodes = new Set<HTMLElement>();

/** Longest a hold may last whatever happens (a safety net, like the hold of a big summon). */
export const DESTROY_HIDE_CAP_MS = 8000;

export function zoneKeyOf(zone: Zone): string {
  return zoneKey(zone.controller, zone.location, zone.sequence);
}

function failsafe(id: string, ms: number, end: () => void): void {
  if (typeof window === "undefined") return;
  const capped = Math.min(DESTROY_HIDE_CAP_MS, Math.max(0, Number.isFinite(ms) ? ms : 0));
  timers.set(id, duelFxClock.setTimeout(end, capped));
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer == null) return;
  if (typeof window !== "undefined") duelFxClock.clearTimeout(timer);
  timers.delete(id);
}

/**
 * The card on `zone` (with this passcode, 0 when unknown) is being destroyed: hide it in its zone.
 * Returns the release. Safe to call twice with the same id (the first hold stays).
 */
export function beginDestroyHide(id: string, zone: Zone, code: number | undefined, failsafeMs: number = DESTROY_HIDE_CAP_MS): () => void {
  const key = `card:${id}`;
  const release = () => endDestroyHide(id);
  if (cardHides.has(id)) return release;
  cardHides.set(id, { id, zone: zoneKeyOf(zone), code: code != null && code > 0 ? code : 0 });
  failsafe(key, failsafeMs, release);
  reconcileDestroyHides();
  return release;
}

export function endDestroyHide(id: string): void {
  clearTimer(`card:${id}`);
  if (!cardHides.delete(id)) return;
  reconcileDestroyHides();
}

/** A card is on its way to the pile on `zone`: its count waits for the landing. */
export function beginPileHold(id: string, zone: Zone, failsafeMs: number = DESTROY_HIDE_CAP_MS): () => void {
  const key = `pile:${id}`;
  const release = () => endPileHold(id);
  if (pileHolds.has(id)) return release;
  pileHolds.set(id, { id, zone: zoneKeyOf(zone) });
  failsafe(key, failsafeMs, release);
  reconcileDestroyHides();
  return release;
}

export function endPileHold(id: string): void {
  clearTimer(`pile:${id}`);
  if (!pileHolds.delete(id)) return;
  reconcileDestroyHides();
}

export function clearDestroyHides(): void {
  for (const key of Array.from(timers.keys())) clearTimer(key);
  cardHides.clear();
  pileHolds.clear();
  reconcileDestroyHides();
}

/** True while a card with this passcode (or any card, when `code` is 0) is hidden in `zone`. */
export function isDestroyHidden(zone: Zone, code: number = 0): boolean {
  const key = zoneKeyOf(zone);
  for (const hide of cardHides.values()) {
    if (hide.zone !== key) continue;
    if (hide.code === 0 || code === 0 || hide.code === code) return true;
  }
  return false;
}

/** How many cards are on their way to the pile on `zone` (the count shows that many fewer). */
export function pileHeldCount(zone: Zone): number {
  const key = zoneKeyOf(zone);
  let held = 0;
  for (const hold of pileHolds.values()) if (hold.zone === key) held += 1;
  return held;
}

/** The count a pile shows while cards are on their way to it: never below zero. */
export function shownPileCount(real: number, held: number): number {
  return Math.max(0, (Number.isFinite(real) ? real : 0) - Math.max(0, held));
}

/** The passcode in the art of a zone's card, or 0 when the zone shows a sleeve or an unknown card. */
export function artCodeOf(art: Element): number {
  const src = art.querySelector("img")?.getAttribute("src") ?? "";
  const match = /\/cards\/(\d+)\/image/.exec(src);
  return match ? Number(match[1]) : 0;
}

/** The hold applies to the card in the zone when it is that card (or one whose face is not known). */
export function holdMatchesCard(holdCode: number, shownCode: number): boolean {
  return holdCode === 0 || shownCode === 0 || holdCode === shownCode;
}

function zoneNode(root: ParentNode, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-zones~="${key}"]`);
}

function hide(el: HTMLElement): void {
  if (hiddenNodes.has(el)) return;
  hiddenNodes.add(el);
  el.style.visibility = "hidden";
  el.dataset.destroyHidden = "true";
}

function show(el: HTMLElement): void {
  hiddenNodes.delete(el);
  el.style.removeProperty("visibility");
  delete el.dataset.destroyHidden;
}

/**
 * Puts the DOM in line with the state: the card frame of each hidden zone shows nothing (the card,
 * its stat plate and the zone marks), and a pile with cards on their way shows the count without them.
 * Idempotent. Call it after the state changes and when React has re-rendered the board.
 */
export function reconcileDestroyHides(root: ParentNode | null = typeof document !== "undefined" ? document : null): void {
  if (!root) return;
  const wantHidden = new Set<HTMLElement>();
  for (const hold of cardHides.values()) {
    const zone = zoneNode(root, hold.zone);
    const art = zone?.querySelector<HTMLElement>("[data-card-art]");
    if (!zone || !art) continue;
    if (!holdMatchesCard(hold.code, artCodeOf(art))) continue;
    const frame = art.parentElement?.parentElement;
    if (!frame || frame === zone || !zone.contains(frame)) continue;
    for (const child of Array.from(frame.children)) if (child instanceof HTMLElement) wantHidden.add(child);
  }
  for (const el of Array.from(hiddenNodes)) if (!wantHidden.has(el)) show(el);
  for (const el of wantHidden) hide(el);

  const wantCount = new Map<HTMLElement, number>();
  for (const hold of pileHolds.values()) {
    const zone = zoneNode(root, hold.zone);
    const label = zone?.querySelector<HTMLElement>("[data-pile-count]");
    if (label) wantCount.set(label, (wantCount.get(label) ?? 0) + 1);
  }
  for (const label of Array.from(countNodes)) {
    if (wantCount.has(label)) continue;
    countNodes.delete(label);
    const real = label.dataset.pileCount ?? "";
    if (label.textContent !== real) label.textContent = real;
  }
  for (const [label, held] of wantCount) {
    countNodes.add(label);
    const text = String(shownPileCount(Number(label.dataset.pileCount), held));
    if (label.textContent !== text) label.textContent = text;
  }
}

/**
 * Keeps the DOM in line while React re-renders the board (a card node replaced, a count updated).
 * Returns the stop function. It does nothing while no hold is set.
 */
export function startDestroyHideGuard(host: Element | null): () => void {
  if (!host || typeof MutationObserver === "undefined") return () => undefined;
  const observer = new MutationObserver(() => {
    if (cardHides.size === 0 && pileHolds.size === 0 && hiddenNodes.size === 0 && countNodes.size === 0) return;
    reconcileDestroyHides(host);
  });
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-pile-count", "data-occupied"] });
  return () => observer.disconnect();
}
