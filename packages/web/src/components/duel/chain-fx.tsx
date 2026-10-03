"use client";

/**
 * The chain on the board, shown once.
 *
 *  - Every link is one numbered medallion (a gold ring, the Chain Link number, a small chain-link
 *    glyph) on the card that activated, with a soft gold ring on the card. A new link drops in with
 *    a clink; the highest link is the largest and sits on top, so the order reads at a glance. A thin
 *    arc joins badge N to badge N-1, so the badges read as one chain. A link that activated from the
 *    hand, the GY, the Extra Deck or the banished pile sits on its slot, or on the hand / pile when
 *    the card has left that slot.
 *  - The off-board strip lists ONLY a link the board cannot place (no known zone, or its card and
 *    its hand / pile are not on screen). A link is a badge or a strip row, never both.
 *  - Screen readers get a visually hidden list ("Chain Link 2: card, Opponent") and a polite live
 *    announcement for each new link, resolution, negation and the end of the chain.
 *  - Resolution: links resolve highest first, and this is the only place it is shown (there is no
 *    centre banner for it). The resolving link takes a gold ring burst on its badge and a soft gold
 *    wash on its card; then its number gives way to a tick, the badge shrinks away and the arc to
 *    it fades. The next link down is marked "up next" (data-next). A negated link is slashed and
 *    greyed before it clears.
 *
 * Events play one beat at a time (see chainStepDelay, about 0.5 to 0.9 s per link), so a chain that
 * resolves inside one engine batch is still readable. The beat times are planned in chain-beats.ts,
 * which the banner layer reads for its sounds and the effect layers read to play a link's move or
 * destroy while, or just after, its badge beat. A page that loads mid-chain starts from the chain
 * as it stands. Everything visual sits on a pointer-transparent overlay, animates only transform
 * and opacity, and the badges follow their zones with `translate` (never layout). Reduced motion:
 * no burst, no movement and no wire; the state shows through colour and opacity, with a short hold
 * so the order stays readable.
 */
import { duelFxClock } from "./fx-clock";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { partnerSeatOf, type DuelChainLink, type DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl, zoneKey } from "./constants";
import { collectFreshEvents, findZoneElement, maxEventId } from "./event-queue";
import {
  applyChainEvent,
  badgeCenter,
  chainAnchor,
  chainAnnouncement,
  chainCallout,
  chainFlow,
  chainFocusLink,
  chainLinkLabel,
  chainSeatLabel,
  chainStackRows,
  chainStackSize,
  chainStateKey,
  chainWirePath,
  coveredFraction,
  deriveChainState,
  EMPTY_CHAIN,
  isChainEvent,
  nextToResolve,
  placeCallout,
  placeChips,
  type CalloutPlace,
  type ChainAnchor,
  type ChainLinkState,
  type ChainState,
} from "./chain-state";
import { chainBeatAt, chainBeatsEndAt, planChainBeats, resetChainBeats } from "./chain-beats";
import { holdPromptReveal } from "./prompt-reveal";
import { PriorityChips, type PrioritySlot } from "./priority-chips";
import styles from "./chain-fx.module.css";

export type ChainFxProps = {
  /** engine.events (a rolling window; ids only grow). */
  events: DuelEvent[];
  /** engine.chain: the snapshot chain, the fallback when the window lost a link. */
  chain: readonly DuelChainLink[];
  /** Changes when the room changes; the chain restarts from the live state. */
  duelKey: string;
  reducedMotion: boolean;
  mySeat: number | null;
  playerName: (seat: number) => string;
  /**
   * Tones of the seats of a table of 3 or 4. When set, each link names its owner ("You" or the player's name, never
   * "Opponent") and wears the owner's tone. Left out (1v1), nothing changes.
   */
  seatTones?: ReadonlyMap<number, { main: string; ink: string }>;
  /** Tables of 3 or 4 seats: who may answer the open chain, in order. The panel lists it under its head. */
  priority?: readonly PrioritySlot[];
  /** The duel is over (a result, or the session is not active): a chain that was open when it ended is cleared. */
  ended?: boolean;
  /** The format of a multi-seat table board ("ffa3", "ffa4", "tag"). It picks the lane the chain stack uses. Left out (1v1), nothing changes. */
  table?: string;
};

function toneVars(tones: ChainFxProps["seatTones"], seat: number): CSSProperties | undefined {
  const tone = tones?.get(seat);
  return tone ? ({ "--seat-main": tone.main, "--seat-ink": tone.ink } as CSSProperties) : undefined;
}

const clock = (): number => (typeof performance !== "undefined" ? duelFxClock.now() : duelFxClock.dateNow());

/**
 * Plays chain events one beat at a time and settles on the live chain when the beats run out.
 * The clock is the beat plan (chain-beats.ts), made in the render phase when a batch arrives, so
 * the banners, sounds and card effects of the same batch can wait for the same beats.
 */
export function useChainPlayback(
  events: readonly DuelEvent[],
  snapshot: readonly DuelChainLink[],
  duelKey: string,
  reducedMotion: boolean,
): ChainState {
  const [state, setState] = useState<ChainState>(() => deriveChainState(events, snapshot));
  const stateRef = useRef(state);
  const cursorRef = useRef<number>(maxEventId(events) ?? 0);
  const queueRef = useRef<DuelEvent[]>([]);
  const timerRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const latest = useRef({ events, snapshot, reducedMotion });
  latest.current = { events, snapshot, reducedMotion };

  // Render phase on purpose (see BattleFx): SummonFx, MoveFx and the banners plan the same batch in
  // their effects, which run after this render, and read the plan. Planning is idempotent.
  const planBase = useRef<{ key: string; after: number } | null>(null);
  if (planBase.current == null || planBase.current.key !== duelKey) {
    planBase.current = { key: duelKey, after: maxEventId(events) ?? 0 };
    resetChainBeats(duelKey);
  }
  const after = planBase.current.after;
  const freshForPlan = events.filter((event) => event.id > after);
  if (freshForPlan.length > 0) planChainBeats(freshForPlan, { now: clock(), reduced: reducedMotion, duelKey });

  const commit = useCallback((next: ChainState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const pump = useCallback(() => {
    if (timerRef.current != null) return;
    const next = queueRef.current[0];
    if (!next) {
      // Out of beats: the live state is the truth.
      const live = deriveChainState(latest.current.events, latest.current.snapshot);
      if (chainStateKey(live) !== chainStateKey(stateRef.current)) commit(live);
      return;
    }
    const wait = (at: number) => {
      timerRef.current = duelFxClock.setTimeout(() => {
        timerRef.current = null;
        pump();
      }, Math.max(0, at - clock()));
    };
    const due = chainBeatAt(next.id);
    if (due - clock() > 8) {
      wait(due);
      return;
    }
    queueRef.current.shift();
    commit(applyChainEvent(stateRef.current, next));
    // Hold this beat until the next one is due, or until the last beat has had its hold.
    const following = queueRef.current[0];
    wait(following ? chainBeatAt(following.id) : chainBeatsEndAt());
  }, [commit]);

  useEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      if (timerRef.current != null) duelFxClock.clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      cursorRef.current = maxEventId(events) ?? 0;
      commit(deriveChainState(events, snapshot));
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    const chainEvents = fresh.filter(isChainEvent);
    // An open response window needs the current targets immediately, including target-only
    // snapshot changes. Playback holds are for resolution; pending links follow the live chain.
    if (snapshot.length > 0 && stateRef.current.links.every((link) => link.status === "pending") &&
      [...queueRef.current, ...chainEvents].every((event) => event.kind === "activate" || event.kind === "target")) {
      if (timerRef.current != null) duelFxClock.clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      const live = deriveChainState(events, snapshot);
      if (chainStateKey(live) !== chainStateKey(stateRef.current)) commit(live);
      return;
    }
    if (chainEvents.length > 0) {
      // Already planned in the render; this only fills a gap.
      planChainBeats(fresh, { now: clock(), reduced: latest.current.reducedMotion, duelKey });
      queueRef.current.push(...chainEvents);
      // The question after a chain waits until the chain has been played to its end.
      if (chainEvents.some((event) => event.kind === "chain-resolving")) holdPromptReveal(chainBeatsEndAt() - clock());
    }
    pump();
  }, [events, snapshot, duelKey, commit, pump]);

  useEffect(
    () => () => {
      if (timerRef.current != null) duelFxClock.clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  return state;
}

/** First element whose data-zones holds a key of this player and location (a pile keys each card). */
function findPileElement(controller: number, location: number): HTMLElement | null {
  const prefix = `${controller}:${location}:`;
  for (const el of document.querySelectorAll<HTMLElement>("[data-zones]")) {
    const keys = (el.dataset.zones ?? "").split(" ");
    if (keys.some((key) => key.startsWith(prefix))) return el;
  }
  return null;
}

function resolveAnchor(anchor: ChainAnchor): HTMLElement | null {
  const exact = findZoneElement(anchor.zone);
  if (exact) return exact;
  const fallback = anchor.fallback;
  if (!fallback) return null;
  if (fallback.kind === "hand") return document.querySelector<HTMLElement>(`[data-hand-seat="${fallback.controller}"]`);
  return findPileElement(fallback.controller, fallback.location);
}

const MIN_BADGE = 28;
const MAX_BADGE = 46;

type Box = { left: number; top: number; width: number; height: number };
/** One link as the read phase of a frame saw it; the write phase applies it. */
type PlacedLink = { link: ChainLinkState; slot: HTMLElement; box: Box | null; size: number; shift: number; half: "high" | "low"; callout: CalloutPlace | null };
type PlacedMark = { link: ChainLinkState; mark: HTMLElement | undefined; wire: SVGPathElement | undefined; box: Box | null; covered: boolean };

/** The card's visible box: a Defense Position card is turned a quarter inside its portrait zone. */
function cardBox(overlay: DOMRect, zone: HTMLElement): Box | null {
  const rect = zone.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4 || overlay.width < 4) return null;
  const cx = rect.left - overlay.left + rect.width / 2;
  const cy = rect.top - overlay.top + rect.height / 2;
  const turned = zone.dataset.defense === "true" && rect.height > rect.width;
  const width = turned ? rect.height : rect.width;
  const height = turned ? rect.width : rect.height;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * The free width left of the board's leftmost zone, pile or LP panel: where the chain stack can stand without
 * covering the field. Reads layout, so it runs in the read phase and only a few times a second.
 */
function freeGutter(origin: DOMRect): number {
  let gutter = origin.width;
  for (const el of document.querySelectorAll<HTMLElement>("[data-zones], [data-lp-seat]")) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.right <= origin.left || rect.left >= origin.right || rect.bottom <= origin.top || rect.top >= origin.bottom) continue;
    gutter = Math.min(gutter, Math.max(0, rect.left - origin.left));
  }
  return gutter;
}
const GUTTER_EVERY_MS = 400;

function artStyle(code: number | null): CSSProperties | undefined {
  return code != null ? { backgroundImage: `url(${cardArtUrl(code)})` } : undefined;
}

/** Two interlocked links. */
function ChainGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g transform="rotate(-40 12 12)" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
        <rect x="1.5" y="8" width="12" height="8" rx="4" />
        <rect x="10.5" y="8" width="12" height="8" rx="4" />
      </g>
    </svg>
  );
}

export function ChainFx({ events, chain, duelKey, reducedMotion, mySeat, playerName, seatTones, priority, ended = false, table }: ChainFxProps) {
  const named = seatTones != null;
  // On Tag the partner's zones read "partner's"; every other seat that is not yours reads by name or "opponent's".
  const partner = table === "tag" && mySeat != null ? partnerSeatOf("tag", mySeat) : null;
  const played = useChainPlayback(events, chain, duelKey, reducedMotion);
  // A duel that ends mid-chain sends no "chain-end": nothing is left to resolve, so nothing stays on the board.
  const state = ended ? EMPTY_CHAIN : played;
  // Badges play historical resolution beats; targeting follows the live engine so a replacement
  // occupant is never marked while old beats play, and chain-end clears target rings immediately.
  const live = useMemo(() => (ended ? EMPTY_CHAIN : deriveChainState(events, chain)), [events, chain, ended]);
  const targetLinks = live.links.filter((link) => link.status !== "resolved");
  const targetsKey = chainStateKey(live);
  const targetLinksRef = useRef(targetLinks);
  targetLinksRef.current = targetLinks;
  const overlayRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLOListElement>(null);
  // The front layer lives in the duel's own root (the element that holds the pace slider's scope), not in the
  // fx slot. A slot or the board is a stacking context, and nothing inside one can rise above its siblings
  // (the prompt slot, the room's prompt dock); the root is above all of them. undefined = not looked up yet,
  // null = no root (a bare mount): the layer stays where it is.
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => {
    setHost(overlayRef.current?.closest<HTMLElement>("[data-duel-fx-speed-root]") ?? null);
  }, []);
  const slotRefs = useRef(new Map<number, HTMLElement>());
  const ringRefs = useRef(new Map<number, HTMLElement>());
  const tagRefs = useRef(new Map<number, HTMLElement>());
  const gutterRef = useRef({ at: Number.NEGATIVE_INFINITY, px: 0 });
  const wireRefs = useRef(new Map<number, SVGPathElement>());
  const targetRefs = useRef(new Map<string, HTMLElement>());
  const targetWireRefs = useRef(new Map<string, SVGPathElement>());
  const arrowId = useId();
  const links = state.links;
  const linksKey = useMemo(() => chainStateKey(state), [state]);
  const linksRef = useRef(links);
  linksRef.current = links;

  // Keep every badge on its card: layout can move under us (resize, a hovered hand card, a summon).
  // Each frame reads the layout first and writes after, so the browser lays out at most once per frame.
  useLayoutEffect(() => {
    if (links.length === 0 && targetLinks.length === 0) return undefined;
    let raf = 0;
    const measure = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      // ---- Read phase: no style write may happen before the last read. ----
      const origin = overlay.getBoundingClientRect();
      const front = frontRef.current;
      const hostRect = front && host ? host.getBoundingClientRect() : null;
      // Open prompt panels and the activation banner, in board pixels: the callout tag and the target marks keep
      // clear of them, so their text stays readable.
      const panels: Box[] = [];
      for (const panel of document.querySelectorAll<HTMLElement>("[data-prompt-panel], [data-feedback-cue]")) {
        const rect = panel.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) panels.push({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
      }
      // The pile viewer mounts inside the board box, so it cannot rise above the front layer: hide the layer instead.
      const pileOpen = document.querySelector("[data-pile-viewer]") != null;
      let gutter = gutterRef.current.px;
      const now = clock();
      if (front && now - gutterRef.current.at >= GUTTER_EVERY_MS) {
        gutter = freeGutter(origin);
        gutterRef.current = { at: now, px: gutter };
      }
      // Life-point plates and the stack's own size, for the chips: they keep clear of both.
      const size = front ? chainStackSize(gutter, front.dataset.size as "full" | "compact" | undefined) : "full";
      let chips: { left: number; top: number } | null = null;
      const panelEl = panelRef.current;
      if (front && size === "compact" && panelEl) {
        const obstacles = panels.slice();
        for (const plate of document.querySelectorAll<HTMLElement>("[data-lp-seat]")) {
          const rect = plate.getBoundingClientRect();
          if (rect.width > 4 && rect.height > 4) obstacles.push({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
        }
        const own = panelEl.getBoundingClientRect();
        chips = placeChips({ width: own.width, height: own.height }, { width: origin.width, height: origin.height }, obstacles);
      }
      const stacked = new Map<HTMLElement, number>();
      const placed: PlacedLink[] = [];
      const centers = new Map<number, { x: number; y: number }>();
      let gap = MIN_BADGE;
      for (const link of linksRef.current) {
        const slot = slotRefs.current.get(link.index);
        if (!slot) continue;
        const anchor = chainAnchor(link);
        const zone = anchor ? resolveAnchor(anchor) : null;
        const box = zone ? cardBox(origin, zone) : null;
        if (!zone || !box) {
          placed.push({ link, slot, box: null, size: 0, shift: 0, half: "high", callout: null });
          continue;
        }
        const shift = stacked.get(zone) ?? 0;
        stacked.set(zone, shift + 1);
        const size = Math.round(Math.min(MAX_BADGE, Math.max(MIN_BADGE, box.width * 0.46)));
        gap = Math.max(gap, size);
        centers.set(link.index, badgeCenter(box, size, shift));
        // The callout tag opens away from the nearer board edge, so it stays on screen.
        const half = box.top + box.height / 2 > origin.height / 2 ? "low" : "high";
        const tag = tagRefs.current.get(link.index);
        const callout = tag
          ? placeCallout({ card: box, board: { width: origin.width, height: origin.height }, tag: { width: tag.offsetWidth, height: tag.offsetHeight }, half, panels })
          : null;
        placed.push({ link, slot, box, size, shift, half, callout });
      }
      const marks: PlacedMark[] = [];
      for (const link of targetLinksRef.current) {
        for (const target of link.targets) {
          const key = `${link.index}:${zoneKey(target.controller, target.location, target.sequence)}`;
          const zone = findZoneElement(target);
          const box = zone ? cardBox(origin, zone) : null;
          marks.push({ link, mark: targetRefs.current.get(key), wire: targetWireRefs.current.get(key), box, covered: box != null && coveredFraction(box, panels) > 0.5 });
        }
      }
      // ---- Write phase. ----
      if (front) {
        const suspended = pileOpen ? "true" : "false";
        if (front.dataset.suspended !== suspended) front.dataset.suspended = suspended;
        if (front.dataset.size !== size) front.dataset.size = size;
        const dock = chips ? `${Math.round(chips.left)},${Math.round(chips.top)}` : "";
        if (front.dataset.dock !== dock) {
          front.dataset.dock = dock;
          if (chips) {
            front.style.setProperty("--chain-dock-left", `${Math.round(chips.left)}px`);
            front.style.setProperty("--chain-dock-top", `${Math.round(chips.top)}px`);
          } else {
            front.style.removeProperty("--chain-dock-left");
            front.style.removeProperty("--chain-dock-top");
          }
        }
        const px = String(Math.round(gutter));
        if (front.dataset.gutter !== px) {
          front.dataset.gutter = px;
          front.style.setProperty("--chain-gutter", `${px}px`);
        }
      }
      // The front layer sits over the board box, wherever the board is inside the root.
      if (front && host && hostRect) {
        const x = Math.round(origin.left - hostRect.left - host.clientLeft);
        const y = Math.round(origin.top - hostRect.top - host.clientTop);
        const geo = `${x},${y},${Math.round(origin.width)},${Math.round(origin.height)}`;
        if (front.dataset.geo !== geo) {
          front.dataset.geo = geo;
          front.style.width = `${origin.width}px`;
          front.style.height = `${origin.height}px`;
          front.style.translate = `${x}px ${y}px`;
        }
      }
      for (const { link, slot, box, size, shift, half, callout } of placed) {
        const ring = ringRefs.current.get(link.index);
        if (!box) {
          if (slot.dataset.placed !== "false") slot.dataset.placed = "false";
          if (ring && ring.dataset.placed !== "false") ring.dataset.placed = "false";
          continue;
        }
        const geo = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)},${size},${shift},${half}`;
        // The badge (front layer) and the card ring and glow (back layer) share one box.
        for (const el of ring ? [slot, ring] : [slot]) {
          if (el.dataset.geo !== geo) {
            el.dataset.geo = geo;
            el.style.width = `${box.width}px`;
            el.style.height = `${box.height}px`;
            el.style.translate = `${box.left}px ${box.top}px`;
            el.style.setProperty("--b", `${size}px`);
            el.style.setProperty("--shift", String(shift));
            el.dataset.half = half;
          }
          if (el.dataset.placed !== "true") el.dataset.placed = "true";
        }
        // The callout tag stays on the board and off every open prompt panel (see placeCallout).
        const tag = tagRefs.current.get(link.index);
        if (tag && callout) {
          const place = `${callout.dx},${callout.side}`;
          if (tag.dataset.place !== place) {
            tag.dataset.place = place;
            tag.style.translate = `calc(-50% + ${callout.dx}px) 0`;
            tag.dataset.side = callout.side;
          }
        }
      }
      // The wire from badge N to badge N-1: only when both badges are on the board and apart.
      for (const [index, wire] of wireRefs.current) {
        const from = centers.get(index - 1);
        const to = centers.get(index);
        const d = from && to ? chainWirePath(from, to, gap * 1.1) : null;
        if (d == null) {
          if (wire.hasAttribute("d")) wire.removeAttribute("d");
        } else if (wire.getAttribute("d") !== d) {
          wire.setAttribute("d", d);
        }
      }
      for (const { link, mark, wire, box, covered } of marks) {
        if (mark) {
          mark.dataset.placed = box ? "true" : "false";
          mark.dataset.covered = covered ? "true" : "false";
          if (box) {
            const geo = `${box.left},${box.top},${box.width},${box.height}`;
            if (mark.dataset.geo !== geo) {
              mark.dataset.geo = geo;
              mark.style.width = `${box.width}px`;
              mark.style.height = `${box.height}px`;
              mark.style.translate = `${box.left}px ${box.top}px`;
            }
          }
        }
        if (wire) {
          const from = centers.get(link.index);
          const to = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
          const d = from && to ? chainWirePath(from, to, gap) : null;
          if (d && wire.getAttribute("d") !== d) wire.setAttribute("d", d);
          else if (!d && wire.hasAttribute("d")) wire.removeAttribute("d");
        }
      }
    };
    const tick = () => {
      measure();
      raf = duelFxClock.requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return undefined;
    }
    tick();
    return () => duelFxClock.cancelAnimationFrame(raf);
  }, [linksKey, links.length, targetsKey, targetLinks.length, host]);

  // Live announcements for screen readers: what changed on this beat of the chain.
  const prevRef = useRef<ChainState>(EMPTY_CHAIN);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const said = chainAnnouncement(prevRef.current, state, mySeat, playerName, named, partner);
    prevRef.current = state;
    if (said != null) setAnnouncement(said);
  }, [state, mySeat, playerName, named, partner]);

  const rows = chainStackRows(state);
  const focus = chainFocusLink(state);
  const topIndex = links.length;
  const nextIndex = nextToResolve(state);
  const attrs = (link: ChainLinkState) => ({
    "data-status": link.status,
    "data-negated": link.negated ? "true" : "false",
    "data-top": link.index === topIndex ? "true" : "false",
    "data-next": link.index === nextIndex ? "true" : "false",
    "data-focus": focus?.index === link.index ? "true" : "false",
  });
  const showStack = links.length > 0;

  // Front layer: the numbered badges, the callout and the chain stack. Above every other board layer (it is
  // portaled into the duel root, see `host`), so a prompt, a banner or a pile cannot cover the chain.
  const front = (
    <div ref={frontRef} className={`${styles.layer} ${styles.front}`} aria-hidden="true" data-chain-fx="front" data-chain-front="true"
      data-portal={host ? "true" : undefined} data-table={table}
      data-open={links.length > 0 ? "true" : "false"} data-reduced={reducedMotion ? "true" : "false"}>
      {links.map((link) => {
        const callout = chainCallout(link, mySeat, playerName, named);
        return (
          <div
            key={link.index}
            ref={(el) => {
              if (el) slotRefs.current.set(link.index, el);
              else slotRefs.current.delete(link.index);
            }}
            className={styles.slot}
            style={{ zIndex: link.index }}
            data-placed="false"
            data-chain-link={link.index}
            {...attrs(link)}
          >
            <span className={styles.badge}>
              <span className={styles.num} data-chain-num="true">{link.index}</span>
              <svg className={styles.tick} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={styles.chip}><ChainGlyph /></span>
            </span>
            {focus?.index === link.index ? (
              <span
                ref={(el) => {
                  if (el) tagRefs.current.set(link.index, el);
                  else tagRefs.current.delete(link.index);
                }}
                className={styles.tag} data-chain-callout={link.index} data-callout-key={`${link.index}:${link.status}`}>
                <b>{callout.label}</b>
                <span className={styles.tagName}>{callout.title}</span>
                <span className={styles.tagAction}>{callout.action}</span>
              </span>
            ) : null}
          </div>
        );
      })}
      {targetLinks.flatMap((link) => link.targets.map((target) => {
        const zone = zoneKey(target.controller, target.location, target.sequence);
        const key = `${link.index}:${zone}`;
        return <div key={key} ref={(el) => {
          if (el) targetRefs.current.set(key, el);
          else targetRefs.current.delete(key);
        }} className={styles.target} data-placed="false" data-chain-target={link.index} data-target-zone={zone}
          style={{ "--target-offset": `${(link.index - 1) * 16}px` } as CSSProperties}>
          <span className={styles.targetRing} />
          <span className={styles.targetTag}>Target · {link.index}</span>
        </div>;
      }))}
      {showStack ? (
        <div className={styles.dock}>
          <ol ref={panelRef} className={styles.panel} data-chain-panel="true" data-priority={priority?.length ? "true" : undefined}>
            <li className={styles.head}>
              <span>Chain</span>
              <small>{links.length} {links.length === 1 ? "link" : "links"}</small>
            </li>
            {priority && priority.length > 0 ? (
              <li className={styles.prioRow}>
                <PriorityChips order={priority} mySeat={mySeat} nameOf={playerName} seatTones={seatTones} compact />
              </li>
            ) : null}
            {rows.map((link) => {
              const callout = chainCallout(link, mySeat, playerName, named);
              const flow = chainFlow(link, mySeat, playerName, { named, partner });
              return (
                <li
                  key={link.index}
                  className={styles.row}
                  data-status={link.status}
                  data-negated={link.negated ? "true" : "false"}
                  data-focus={focus?.index === link.index ? "true" : "false"}
                  data-mine={mySeat != null && link.seat === mySeat ? "true" : "false"}
                  data-chain-row={link.index}
                  data-toned={seatTones?.has(link.seat) ? "true" : undefined}
                  style={toneVars(seatTones, link.seat)}
                >
                  <b className={styles.rowNum}>{link.index}</b>
                  <span className={styles.thumb} style={artStyle(link.code)} />
                  <span className={styles.text}>
                    <span className={styles.name}>{flow.source}</span>
                    <small className={styles.who}>{callout.owner} · {callout.action}</small>
                    {flow.effect ? <small className={styles.flowEffect}><i aria-hidden="true">→</i> {flow.effect}</small> : null}
                    {flow.targets.length > 0 ? <small className={styles.flowTargets}><i aria-hidden="true">→</i> {flow.targets.join(", ")}</small> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div className={styles.sr} data-chain-sr="true">
        {links.length > 0 ? (
          <ol aria-label="Current chain" data-chain-sr-list="true">
            {links.map((link) => (
              <li key={link.index} data-chain-sr-link={link.index}>{chainLinkLabel(link, mySeat, playerName, true, named, partner)}</li>
            ))}
          </ol>
        ) : null}
        <p role="status" aria-live="polite" aria-atomic="true" data-chain-live="true">{announcement}</p>
      </div>
      {/* Back layer: the card ring and glow, the wires and the target marks. Under the prompt and the banners. */}
      <div ref={overlayRef} className={styles.layer} aria-hidden="true" data-chain-fx="true"
        data-open={links.length > 0 ? "true" : "false"} data-reduced={reducedMotion ? "true" : "false"}>
        {!reducedMotion ? (
          <svg className={styles.wires} data-chain-wires="true" aria-hidden="true" focusable="false">
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 Z" fill="var(--duel-pen-ink, #c6b6ff)" />
              </marker>
            </defs>
            {links.filter((link) => link.index > 1).map((link) => (
              <path
                key={link.index}
                ref={(el) => {
                  if (el) wireRefs.current.set(link.index, el);
                  else wireRefs.current.delete(link.index);
                }}
                className={styles.wire}
                data-chain-wire={link.index}
                data-status={link.status}
              />
            ))}
            {targetLinks.flatMap((link) => link.targets.map((target) => {
              const key = `${link.index}:${zoneKey(target.controller, target.location, target.sequence)}`;
              return <path key={key} ref={(el) => {
                if (el) targetWireRefs.current.set(key, el);
                else targetWireRefs.current.delete(key);
              }} className={styles.targetWire} markerEnd={`url(#${arrowId})`} data-chain-target-wire={link.index} />;
            }))}
          </svg>
        ) : null}
        {links.map((link) => (
          <div
            key={link.index}
            ref={(el) => {
              if (el) ringRefs.current.set(link.index, el);
              else ringRefs.current.delete(link.index);
            }}
            className={styles.slot}
            data-placed="false"
            data-chain-card={link.index}
            {...attrs(link)}
          >
            <span className={styles.glow} />
            <span className={styles.ring} />
            <span className={styles.wash} />
          </div>
        ))}
      </div>
      {host === undefined ? null : host ? createPortal(front, host) : front}
    </>
  );
}
