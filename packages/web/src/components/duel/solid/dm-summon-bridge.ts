import { duelFxClock } from "../fx-clock";
import { DM_CARD_FADE_MS, DM_SLOT_MAX_MS, dmDurationMs, tiltDegOfCss } from "../fx3d/effects/deckmaster-summon-timeline";
import { getSharedFx3d, viewportToHost } from "../fx3d/shared";
import type { FxRect } from "../fx3d/types";

/**
 * 3D mode only: plays the Deck Master summon hologram ("summon:deckmaster") on the shared fx3d
 * canvas. The solid chunk imports this file; the classic board never does, so classic never loads
 * it. It imports no `three` (the effect itself lives in the engine chunk).
 *
 * The caller (SummonFx / the 3D-mode room, at the moment V1 would fly the Deck Master from its dock
 * to the zone) passes the elements. This module measures them, hides the pictures the hologram
 * stands in for, plays the effect, and gives everything back, also when the effect is cancelled.
 *   - The page card stays hidden until the settle beat (900 ms), then fades in over 220 ms.
 *   - The dock picture is hidden while the flier leaves it.
 * It returns false when nothing was drawn (no canvas yet): the caller then keeps the V1 effect.
 */

export type DeckMasterSummonInput = {
  /** Passcode of the Deck Master (the hologram art). */
  code: number;
  /** The seat that owns the Deck Master: finds its dock or chip. */
  seat: number;
  /** The zone the Deck Master is summoned to (the [data-zones] slot). */
  zone: Element;
  /** The page card standing in that zone. It is hidden until the settle beat. Null: nothing to hide. */
  card?: Element | null;
  /** `.sv-plane`: its computed `--tilt` is the table tilt. Null or flat: 0. */
  plane?: Element | null;
  reduced: boolean;
  signal?: AbortSignal;
};

/** Longest the card or dock stays hidden whatever happens (the effect plus the slot's slack). */
const SAFETY_MS = DM_SLOT_MAX_MS + 600;

/** Table tilt in degrees from the plane's computed `--tilt`. */
export function readPlaneTiltDeg(plane: Element | null | undefined): number {
  if (!plane || typeof getComputedStyle === "undefined") return 0;
  return tiltDegOfCss(getComputedStyle(plane).getPropertyValue("--tilt"));
}

const big = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width >= 4 && r.height >= 4;
};

/** The dock picture on the desktop rail, else the chip on a phone, else null. */
export function findDockSource(seat: number): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const images = Array.from(document.querySelectorAll<HTMLElement>(`[data-master-dock="${seat}"] img`)).filter(big);
  if (images[0]) return images[0];
  const chip = Array.from(document.querySelectorAll<HTMLElement>(`[data-sv-dm-chip="${seat}"]`)).filter(big);
  return chip[0] ?? null;
}

/** Starts loading and uploading the art early (call when the Deck Master is known). */
export function prewarmDeckMasterArt(code: number): void {
  if (code > 0) getSharedFx3d()?.api.prefetchArt(code, true);
}

/** The canvas can draw right now: the summon would be drawn by fx3d. */
export function deckMasterSummonReady(): boolean {
  return getSharedFx3d() != null;
}

/** How long the effect runs (ms), for gates that wait for it. Never above the V1 slot of 1.2 s. */
export function deckMasterSummonMs(reduced: boolean): number {
  return Math.min(DM_SLOT_MAX_MS, dmDurationMs(reduced));
}

function toRect(el: Element, host: { left: number; top: number }): FxRect {
  const r = el.getBoundingClientRect();
  return viewportToHost({ left: r.left, top: r.top, width: r.width, height: r.height }, host);
}

export async function playDeckMasterSummon(input: DeckMasterSummonInput): Promise<boolean> {
  const shared = getSharedFx3d();
  if (!shared || input.signal?.aborted) return false;
  const hostBox = shared.host.getBoundingClientRect();
  const host = { left: hostBox.left, top: hostBox.top };
  const rect = toRect(input.zone, host);
  const cardEl = input.card ?? null;
  const dock = findDockSource(input.seat);
  const from = dock ? toRect(dock, host) : { x: rect.x, y: rect.y + rect.h, w: rect.w * 0.6, h: rect.h * 0.6 };

  prewarmDeckMasterArt(input.code);

  // Hide what the hologram stands in for.
  const card = cardEl as HTMLElement | null;
  const saved = card ? card.style.opacity : "";
  if (card && !input.reduced) card.style.opacity = "0";
  const dockImg = dock && dock instanceof HTMLImageElement && !input.reduced ? dock : null;
  const dockSaved = dockImg ? dockImg.style.visibility : "";
  if (dockImg) dockImg.style.visibility = "hidden";
  let dockTimer = 0;
  if (dockImg) dockTimer = duelFxClock.setTimeout(() => { dockImg.style.visibility = dockSaved; }, 340);

  let cardShown = false;
  const showCard = (): void => {
    if (cardShown || !card) return;
    cardShown = true;
    card.style.opacity = saved;
    if (!input.reduced) {
      try { duelFxClock.animate(card, [{ opacity: 0 }, { opacity: 1 }], { duration: DM_CARD_FADE_MS, easing: "ease-out", fill: "backwards" }); } catch { /* no animation: the card just shows */ }
    }
  };
  const safety = duelFxClock.setTimeout(showCard, SAFETY_MS);

  try {
    await shared.api.play("summon:deckmaster", {
      rect,
      artCode: input.code,
      deckmaster: { from, card: card ? toRect(card, host) : undefined, tiltDeg: readPlaneTiltDeg(input.plane), reduced: input.reduced, onSettle: showCard },
    }, input.signal);
    return true;
  } finally {
    duelFxClock.clearTimeout(safety);
    duelFxClock.clearTimeout(dockTimer);
    if (dockImg) dockImg.style.visibility = dockSaved;
    showCard();
  }
}
