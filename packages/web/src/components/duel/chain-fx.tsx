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
 *  - Resolution: links resolve highest first. The resolving link pulses (badge and ring); a negated
 *    link is struck through and dimmed.
 *
 * Events play one beat at a time (see chainStepDelay), so a chain that resolves inside one engine
 * batch is still readable. A page that loads mid-chain starts from the chain as it stands.
 * Everything visual sits on a pointer-transparent overlay, animates only transform and opacity, and
 * the badges follow their zones with `translate` (never layout). Reduced motion: no movement and no
 * wire, the state shows through colour and opacity.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DuelChainLink, DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl } from "./constants";
import { collectFreshEvents, findZoneElement, maxEventId } from "./event-queue";
import {
  applyChainEvent,
  badgeCenter,
  chainAnchor,
  chainAnnouncement,
  chainLinkLabel,
  chainSeatLabel,
  chainStateKey,
  chainStepDelay,
  chainWirePath,
  deriveChainState,
  EMPTY_CHAIN,
  isChainEvent,
  strayLinks,
  type ChainAnchor,
  type ChainLinkState,
  type ChainState,
} from "./chain-state";
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
};

/** Plays chain events one beat at a time and settles on the live chain when the beats run out. */
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

  const commit = useCallback((next: ChainState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const pump = useCallback(() => {
    if (timerRef.current != null) return;
    const next = queueRef.current.shift();
    if (!next) {
      // Out of beats: the live state is the truth.
      const live = deriveChainState(latest.current.events, latest.current.snapshot);
      if (chainStateKey(live) !== chainStateKey(stateRef.current)) commit(live);
      return;
    }
    commit(applyChainEvent(stateRef.current, next));
    const wait = chainStepDelay(next.kind, queueRef.current.length, latest.current.reducedMotion);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pump();
    }, wait);
  }, [commit]);

  useEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      cursorRef.current = maxEventId(events) ?? 0;
      commit(deriveChainState(events, snapshot));
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    for (const event of fresh) if (isChainEvent(event)) queueRef.current.push(event);
    pump();
  }, [events, snapshot, duelKey, commit, pump]);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
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

const MIN_BADGE = 22;
const MAX_BADGE = 38;

type Box = { left: number; top: number; width: number; height: number };

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

function artStyle(code: number | null): CSSProperties | undefined {
  return code != null ? { backgroundImage: `url(${cardArtUrl(code)})` } : undefined;
}

function linkLabel(link: ChainLinkState): string {
  return link.name ?? "Effect";
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

const NO_LINKS: ReadonlySet<number> = new Set();

export function ChainFx({ events, chain, duelKey, reducedMotion, mySeat, playerName }: ChainFxProps) {
  const state = useChainPlayback(events, chain, duelKey, reducedMotion);
  const overlayRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef(new Map<number, HTMLElement>());
  const wireRefs = useRef(new Map<number, SVGPathElement>());
  const [lost, setLost] = useState<ReadonlySet<number>>(NO_LINKS);
  const lostKeyRef = useRef("");
  const links = state.links;
  const linksKey = useMemo(() => chainStateKey(state), [state]);
  const linksRef = useRef(links);
  linksRef.current = links;

  // Keep every badge on its card: layout can move under us (resize, a hovered hand card, a summon).
  useLayoutEffect(() => {
    if (links.length === 0) {
      if (lostKeyRef.current !== "") {
        lostKeyRef.current = "";
        setLost(NO_LINKS);
      }
      return undefined;
    }
    let raf = 0;
    const measure = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const origin = overlay.getBoundingClientRect();
      const stacked = new Map<HTMLElement, number>();
      const centers = new Map<number, { x: number; y: number }>();
      const gone: number[] = [];
      let gap = MIN_BADGE;
      for (const link of linksRef.current) {
        const slot = slotRefs.current.get(link.index);
        if (!slot) continue;
        const anchor = chainAnchor(link);
        const zone = anchor ? resolveAnchor(anchor) : null;
        const box = zone ? cardBox(origin, zone) : null;
        if (!zone || !box) {
          gone.push(link.index);
          if (slot.dataset.placed !== "false") slot.dataset.placed = "false";
          continue;
        }
        const shift = stacked.get(zone) ?? 0;
        stacked.set(zone, shift + 1);
        const size = Math.round(Math.min(MAX_BADGE, Math.max(MIN_BADGE, box.width * 0.4)));
        gap = Math.max(gap, size);
        centers.set(link.index, badgeCenter(box, size, shift));
        const geo = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)},${size},${shift}`;
        if (slot.dataset.geo !== geo) {
          slot.dataset.geo = geo;
          slot.style.width = `${box.width}px`;
          slot.style.height = `${box.height}px`;
          slot.style.translate = `${box.left}px ${box.top}px`;
          slot.style.setProperty("--b", `${size}px`);
          slot.style.setProperty("--shift", String(shift));
        }
        if (slot.dataset.placed !== "true") slot.dataset.placed = "true";
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
      const key = gone.join(",");
      if (key !== lostKeyRef.current) {
        lostKeyRef.current = key;
        setLost(gone.length > 0 ? new Set(gone) : NO_LINKS);
      }
    };
    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return undefined;
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, [linksKey, links.length]);

  // Live announcements for screen readers: what changed on this beat of the chain.
  const prevRef = useRef<ChainState>(EMPTY_CHAIN);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const said = chainAnnouncement(prevRef.current, state, mySeat, playerName);
    prevRef.current = state;
    if (said != null) setAnnouncement(said);
  }, [state, mySeat, playerName]);

  const rows = strayLinks(state, lost);
  const topIndex = links.length;

  return (
    <>
      <div className={styles.sr} data-chain-sr="true">
        {links.length > 0 ? (
          <ol aria-label="Current chain" data-chain-sr-list="true">
            {links.map((link) => (
              <li key={link.index} data-chain-sr-link={link.index}>{chainLinkLabel(link, mySeat, playerName)}</li>
            ))}
          </ol>
        ) : null}
        <p role="status" aria-live="polite" aria-atomic="true" data-chain-live="true">{announcement}</p>
      </div>
      <div ref={overlayRef} className={styles.layer} aria-hidden="true" data-chain-fx="true"
        data-open={links.length > 0 ? "true" : "false"} data-reduced={reducedMotion ? "true" : "false"}>
        {!reducedMotion ? (
          <svg className={styles.wires} data-chain-wires="true" aria-hidden="true" focusable="false">
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
          </svg>
        ) : null}
        {links.map((link) => (
          <div
            key={link.index}
            ref={(el) => {
              if (el) slotRefs.current.set(link.index, el);
              else slotRefs.current.delete(link.index);
            }}
            className={styles.slot}
            style={{ zIndex: link.index }}
            data-placed="false"
            data-status={link.status}
            data-negated={link.negated ? "true" : "false"}
            data-top={link.index === topIndex ? "true" : "false"}
            data-chain-link={link.index}
          >
            <span className={styles.ring} />
            <span className={styles.badge}>
              <span className={styles.num} data-chain-num="true">{link.index}</span>
              <span className={styles.chip}><ChainGlyph /></span>
            </span>
          </div>
        ))}
        {rows.length > 0 ? (
          <div className={styles.dock}>
            <ol className={styles.panel} data-chain-panel="true">
              <li className={styles.head}>
                <span>Chain</span>
                <small>off board</small>
              </li>
              {rows.map((link) => (
                <li
                  key={link.index}
                  className={styles.row}
                  data-status={link.status}
                  data-negated={link.negated ? "true" : "false"}
                  data-mine={mySeat != null && link.seat === mySeat ? "true" : "false"}
                  data-chain-row={link.index}
                >
                  <b className={styles.rowNum}>{link.index}</b>
                  <span className={styles.thumb} style={artStyle(link.code)} />
                  <span className={styles.text}>
                    <span className={styles.name}>{linkLabel(link)}</span>
                    <small className={styles.who}>{chainSeatLabel(link.seat, mySeat, playerName)}</small>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </>
  );
}
