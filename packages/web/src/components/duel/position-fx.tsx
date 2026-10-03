"use client";

/**
 * Position changes for monsters on the board ("position" events).
 *
 *  - Turn (Attack to Defense or back): the real card turns a quarter in place, lifting a little on
 *    the way and settling with a small overshoot, about 400 ms. A soft shadow under it sells the lift.
 *  - Reveal (face-down to face-up: an attacked Set monster, a Flip Summon, a flipped-up effect): a
 *    copy of the card flips over in 3D on the zone, back to face, with a glint across the face, about
 *    560 ms. The face is fully showing by 380 ms, before a battle slash lands (BATTLE_IMPACT_MS, 490).
 *    The real card is hidden underneath until the copy is done, so nothing shows twice.
 *  - Conceal (face-up to face-down, Book of Moon): the same flip the other way.
 *
 * A Flip Summon arrives as a "summon" plus a "position" reveal: this layer draws the reveal and
 * SummonFx stays quiet, unless the summon is heavy (its hologram already lands face-up), in which
 * case the reveal here is skipped. Reduced motion: the new state fades in over 150 ms.
 * Everything is a Web Animation on a pointer-transparent overlay.
 */
import { duelFxClock } from "./fx-clock";
import { useLayoutEffect, useRef, useState } from "react";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl } from "./constants";
import {
  collectFreshEvents,
  DUEL_FX_CUE_EVENT,
  findZoneElement,
  flipCoveredBySummon,
  isPositionEvent,
  maxEventId,
  positionChangeOf,
  type DuelFxCue,
  type DuelFxCueDetail,
  type PositionChange,
  type PositionEvent,
} from "./event-queue";
import { chainEffectAt } from "./chain-beats";
import { getMovePlan, isMoveEvent } from "./move-plan";
import styles from "./position-fx.module.css";
import { Track } from "./summon-fx";
import { CARD_FX } from "./duel-timing";

export type PositionFxProps = {
  /** engine.events (a rolling window; ids only grow). Play only events newer than the first render. */
  events: DuelEvent[];
  /** Changes when the room changes; reset the cursor on change. */
  duelKey: string;
  reducedMotion: boolean;
};

/** A quarter turn between Attack and Defense Position. */
export const TURN_MS = CARD_FX.turnMs;
/** A face-down card turning face-up (or the reverse): whole flip including the glint. */
export const FLIP_REVEAL_MS = CARD_FX.flipRevealMs;
/** When the face is fully showing during a reveal. Under BattleFx's BATTLE_IMPACT_MS (about 650) on purpose. */
export const FLIP_FACE_AT_MS = CARD_FX.flipFaceAtMs;
/** Reduced motion: the new state fades in. */
export const REDUCED_MS = 150;

const CARD_ASPECT = 0.686;
const STAGGER_MS = CARD_FX.staggerMs;
const MAX_STAGGER_STEPS = 5;
const MAX_ITEMS = 8;

type Item = {
  key: string;
  event: PositionEvent;
  change: PositionChange;
  card: DuelCardInfo | null;
  delayMs: number;
  reduced: boolean;
};

type Geo = { left: number; top: number; w: number; h: number; radius: number; side: "you" | "opp" };

function measure(overlay: HTMLElement, zone: HTMLElement): Geo | null {
  const o = overlay.getBoundingClientRect();
  const z = zone.getBoundingClientRect();
  if (z.width < 4 || z.height < 4 || o.width < 4) return null;
  const h = z.height;
  const w = Math.min(z.width, h * CARD_ASPECT);
  const cx = z.left - o.left + z.width / 2;
  const cy = z.top - o.top + z.height / 2;
  return { left: cx - w / 2, top: cy - h / 2, w, h, radius: Math.max(2, w * 0.05), side: zone.dataset.side === "opp" ? "opp" : "you" };
}

function place(el: HTMLElement | null, geo: Geo): void {
  if (!el) return;
  el.style.left = `${geo.left}px`;
  el.style.top = `${geo.top}px`;
  el.style.width = `${geo.w}px`;
  el.style.height = `${geo.h}px`;
  el.style.setProperty("--fx-r", `${geo.radius}px`);
  el.style.setProperty("--fx-w", `${geo.w}px`);
}

function artOf(zone: HTMLElement): HTMLElement | null {
  return zone.querySelector<HTMLElement>("[data-card-art]");
}

/** The frame that holds the card art and its stat plate. */
function cardBodyOf(zone: HTMLElement): HTMLElement | null {
  const art = artOf(zone);
  if (!art) return null;
  const body = art.parentElement?.parentElement;
  return body && body !== zone && zone.contains(body) ? body : art;
}

function emitCue(cue: DuelFxCue): void {
  if (typeof window === "undefined") return;
  const detail: DuelFxCueDetail = { cue, strength: 1 };
  window.dispatchEvent(new CustomEvent<DuelFxCueDetail>(DUEL_FX_CUE_EVENT, { detail }));
}

type EffectProps = { item: Item; overlay: HTMLElement; done: () => void };

function useSetup(
  { item, overlay, done }: EffectProps,
  setup: (ctx: { track: Track; zone: HTMLElement; geo: Geo; d: number }) => void,
): void {
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const doneRef = useRef(done);
  doneRef.current = done;
  useLayoutEffect(() => {
    const zone = findZoneElement(item.event.zone);
    const geo = zone ? measure(overlay, zone) : null;
    if (!zone || !geo) {
      doneRef.current();
      return undefined;
    }
    const track = new Track();
    let alive = true;
    setupRef.current({ track, zone, geo, d: item.delayMs });
    void track.settled().then(() => {
      if (alive) doneRef.current();
    });
    return () => {
      alive = false;
      track.dispose();
    };
    // The item is immutable for its whole life: set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Reduced motion: the card in its new position fades in. */
function FadeFx(props: EffectProps) {
  useSetup(props, ({ track, zone, d }) => {
    track.play(cardBodyOf(zone), [{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, delay: d, fill: "backwards", easing: "ease-out" });
  });
  return null;
}

/** Turn: the real card rotates a quarter in place with a lift; a shadow in the overlay follows it. */
function TurnFx(props: EffectProps) {
  const shadow = useRef<HTMLSpanElement>(null);
  const { change } = props.item;
  useSetup(props, ({ track, zone, geo, d }) => {
    place(shadow.current?.parentElement ?? null, geo);
    const art = artOf(zone);
    const from = change.fromDefense ? 90 : 0;
    const to = change.toDefense ? 90 : 0;
    const over = to > from ? 4 : -4;
    const lift = geo.side === "opp" ? 3 : -3;
    // The element's own stylesheet transform is the end state, so the animation only needs to get there.
    track.play(
      art,
      [
        { transform: `rotate(${from}deg) translateY(0) scale(1)`, easing: "cubic-bezier(0.3, 0, 0.5, 1)" },
        { transform: `rotate(${from + (to - from) * 0.55}deg) translateY(${lift}%) scale(1.07)`, offset: 0.45, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
        { transform: `rotate(${to + over}deg) translateY(0) scale(1)`, offset: 0.82, easing: "ease-out" },
        { transform: `rotate(${to}deg) translateY(0) scale(1)` },
      ],
      { duration: TURN_MS, delay: d, fill: "backwards", easing: "linear" },
    );
    track.play(
      shadow.current,
      [
        { opacity: 0, transform: "scale(1)" },
        { opacity: 0.6, transform: "scale(1.12)", offset: 0.45 },
        { opacity: 0, transform: "scale(1)" },
      ],
      { duration: TURN_MS, delay: d, fill: "backwards", easing: "ease-in-out" },
    );
    track.after(d, () => emitCue("turn"));
  });
  return (
    <div className={styles.anchor}>
      <span ref={shadow} className={styles.shadow} />
    </div>
  );
}

/** Reveal or conceal: a copy of the card flips over in 3D on the zone while the real card waits hidden. */
function FlipFx(props: EffectProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const glint = useRef<HTMLSpanElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  const { change, card } = props.item;
  const reveal = change.reveal;
  useSetup(props, ({ track, zone, geo, d }) => {
    place(anchor.current, geo);
    // The copy sits on the opponent's card, which is turned half way (field.module.css).
    const base = geo.side === "opp" ? 180 : 0;
    const from = base + (change.fromDefense ? 90 : 0);
    const to = base + (change.toDefense ? 90 : 0);
    const body = cardBodyOf(zone);
    const total = FLIP_REVEAL_MS;
    const faceAt = FLIP_FACE_AT_MS / total;
    // The real card is invisible for exactly as long as the copy is on top of it.
    track.play(body, [{ opacity: 0 }, { opacity: 0 }], { duration: d + total, fill: "backwards" });
    track.play(
      anchor.current,
      [
        { transform: `rotate(${from}deg) scale(1)`, offset: 0, easing: "cubic-bezier(0.3, 0, 0.5, 1)" },
        { transform: `rotate(${from + (to - from) * 0.5}deg) scale(1.09)`, offset: faceAt * 0.5, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
        { transform: `rotate(${to}deg) scale(1)`, offset: Math.min(0.98, faceAt + 0.06) },
        { transform: `rotate(${to}deg) scale(1)`, offset: 1 },
      ],
      { duration: total, delay: d, fill: "both", easing: "linear" },
    );
    const start = reveal ? 180 : 0;
    const end = reveal ? 0 : 180;
    track.play(
      flipper.current,
      [
        { transform: `rotateY(${start}deg)`, offset: 0, easing: "cubic-bezier(0.55, 0, 0.9, 0.5)" },
        { transform: `rotateY(${(start + end) / 2}deg)`, offset: faceAt * 0.5, easing: "cubic-bezier(0.1, 0.6, 0.3, 1)" },
        { transform: `rotateY(${end}deg)`, offset: faceAt },
        { transform: `rotateY(${end}deg)`, offset: 1 },
      ],
      { duration: total, delay: d, fill: "both", easing: "linear" },
    );
    track.play(
      shadow.current,
      [
        { opacity: 0.2, offset: 0 },
        { opacity: 0.7, offset: faceAt * 0.5 },
        { opacity: 0, offset: faceAt + 0.1 },
        { opacity: 0, offset: 1 },
      ],
      { duration: total, delay: d, fill: "both", easing: "ease-in-out" },
    );
    if (reveal) {
      track.play(
        glint.current,
        [
          { opacity: 0, transform: "translateX(-130%) skewX(-18deg)", offset: 0 },
          { opacity: 0, transform: "translateX(-130%) skewX(-18deg)", offset: faceAt - 0.08 },
          { opacity: 0.95, transform: "translateX(-40%) skewX(-18deg)", offset: faceAt + 0.08 },
          { opacity: 0, transform: "translateX(140%) skewX(-18deg)", offset: 1 },
        ],
        { duration: total, delay: d, fill: "both", easing: "ease-out" },
      );
    }
    track.after(d, () => emitCue("flip"));
  });
  return (
    <div ref={anchor} className={styles.anchor} data-flip={reveal ? "reveal" : "conceal"}>
      <span ref={shadow} className={styles.shadow} />
      <div ref={flipper} className={styles.flipper}>
        <div className={styles.face}>
          {card ? <img className={styles.art} src={cardArtUrl(card.code, "small")} alt="" draggable={false} /> : null}
          <span ref={glint} className={styles.glint} />
        </div>
        <div className={styles.back} />
      </div>
    </div>
  );
}

/** Flip of a card whose identity was not sent: the real element half-turns in place to its new face. */
function HalfFlipFx(props: EffectProps) {
  const { change } = props.item;
  useSetup(props, ({ track, zone, d }) => {
    const rot = change.toDefense ? 90 : 0;
    track.play(
      artOf(zone),
      [
        { transform: `rotate(${rot}deg) perspective(600px) rotateY(90deg)`, opacity: 0.7 },
        { transform: `rotate(${rot}deg) perspective(600px) rotateY(0deg)`, opacity: 1 },
      ],
      { duration: FLIP_FACE_AT_MS * 0.6, delay: d + FLIP_FACE_AT_MS * 0.4, fill: "backwards", easing: "cubic-bezier(0.1, 0.6, 0.3, 1)" },
    );
    track.after(d, () => emitCue("flip"));
  });
  return null;
}

function FxView(props: EffectProps) {
  const { item } = props;
  if (item.reduced) return <FadeFx {...props} />;
  if (item.change.reveal || item.change.conceal) {
    return item.card ? <FlipFx {...props} /> : <HalfFlipFx {...props} />;
  }
  return <TurnFx {...props} />;
}

function visibleCard(event: DuelEvent): DuelCardInfo | null {
  const card = event.card;
  return card != null && card.code > 0 ? card : null;
}

/** When a flight lands on this zone in the same batch, the position change waits for it. */
function landingAt(fresh: readonly DuelEvent[], event: PositionEvent): number | null {
  for (const other of fresh) {
    if (!isMoveEvent(other) || other.id > event.id) continue;
    const to = other.zone!;
    if (to.controller !== event.zone.controller || to.location !== event.zone.location || to.sequence !== event.zone.sequence) continue;
    const plan = getMovePlan(other.id);
    if (plan) return plan.landAt + plan.holdMs;
  }
  return null;
}

export function PositionFx({ events, duelKey, reducedMotion }: PositionFxProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const seqRef = useRef(0);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  useLayoutEffect(() => {
    setOverlay(overlayRef.current);
  }, []);

  useLayoutEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursorRef.current = null;
      setItems([]);
    }
    if (cursorRef.current == null) {
      cursorRef.current = maxEventId(events) ?? 0;
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    if (fresh.length === 0) return;
    if (typeof document !== "undefined" && document.hidden) return;

    const now = typeof performance !== "undefined" ? duelFxClock.now() : 0;
    const planned: Item[] = [];
    let step = 0;
    for (const event of fresh) {
      if (!isPositionEvent(event) || !findZoneElement(event.zone)) continue;
      const change = positionChangeOf(event);
      if (!change.turn && !change.reveal && !change.conceal) continue;
      if (flipCoveredBySummon(fresh, event)) continue;
      let delayMs = Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS;
      const landAt = landingAt(fresh, event);
      if (landAt != null) delayMs = Math.max(delayMs, landAt - now);
      // A flip that is the effect of a resolving chain link plays while its badge is lit.
      const chainAt = chainEffectAt(event.id);
      if (chainAt > now) delayMs = Math.max(delayMs, chainAt - now);
      step += 1;
      seqRef.current += 1;
      planned.push({
        key: `${event.id}-${seqRef.current}`,
        event,
        change,
        card: visibleCard(event),
        delayMs,
        reduced: reducedRef.current,
      });
    }
    if (planned.length === 0) return;
    setItems((current) => [...current, ...planned].slice(-MAX_ITEMS));
  }, [duelKey, events]);

  const finish = (key: string) => setItems((current) => current.filter((item) => item.key !== key));

  return (
    <div ref={overlayRef} className={styles.layer} aria-hidden="true">
      {overlay ? items.map((item) => <FxView key={item.key} item={item} overlay={overlay} done={() => finish(item.key)} />) : null}
    </div>
  );
}
