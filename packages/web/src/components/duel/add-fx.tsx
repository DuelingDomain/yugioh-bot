"use client";

/**
 * The "Added to hand" showcase (see add-to-hand.ts for the plan and the timing).
 *
 * A card that an effect put into a hand rises from where the player saw it (the card strip, the pile,
 * the zone) to a showcase spot near the middle of the board at a large size, with a gold glow, an
 * "Added to hand" label and where it came from. It stays there long enough to read, then flies into the
 * hand slot, settles with a small bounce and the real card takes over under a ring of light. MoveFx
 * keeps the real hand card invisible until `landed` is called, so the card is never seen twice.
 *
 * Privacy: when the face is not known (the opponent searched their Deck) the card is shown as a card
 * back. A structured confirmation turns the showcase over independently of the live hand slot.
 *
 * Reduced motion: no travel. The card fades in at the showcase spot with the label, holds, and fades
 * out as the real card shows in the hand.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { cardArtUrl, LOCATION_EXTRA } from "./constants";
import { findMoveDestination, followMoveDestination, handArrivalTarget, moveDestinationRotation } from "./event-queue";
import { artCodeOf } from "./destroy-hide";
import { buildShowcaseFrames, showcaseBox, showcaseSourceLabel, ADDED_TITLE } from "./add-to-hand";
import { CARD_FX } from "./duel-timing";
import { Track } from "./summon-fx";
import { retargetFlight } from "./live-flight";
import type { MovePlan } from "./move-plan";
import fx from "./move-fx.module.css";
import styles from "./add-fx.module.css";

const REVEAL_FLIP_MS = 340;

type Props = {
  plan: MovePlan;
  confirmedCard?: DuelCardInfo;
  overlay: HTMLElement;
  /** The flight reached the hand: the real card may show. */
  landed: () => void;
  done: () => void;
};

export function ShowcaseGhost({ plan, confirmedCard, overlay, landed, done }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const aura = useRef<HTMLSpanElement>(null);
  const labelEl = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const landedRef = useRef(landed);
  landedRef.current = landed;
  const doneRef = useRef(done);
  doneRef.current = done;
  const showcase = plan.showcase;
  const known = plan.event.card?.code || confirmedCard?.code || 0;
  const initialCode = useRef(known);
  const shownCode = useRef(known);
  const showing = useRef(known > 0 ? 0 : 180);
  const [code, setCode] = useState(known);
  const [side, setSide] = useState<"you" | "opp">("you");
  const [fullReady, setFullReady] = useState(false);
  const sleeve = plan.event.from?.location === LOCATION_EXTRA ? "extra" : "deck";
  const source = showcaseSourceLabel(plan.event.from, plan.event.zone, side);

  useLayoutEffect(() => {
    const target = handArrivalTarget(plan.event);
    const el = root.current;
    const o = overlay.getBoundingClientRect();
    const z = target?.rect;
    if (!showcase || !target || !el || !z || z.width < 4 || z.height < 4 || o.width < 4) {
      landedRef.current();
      doneRef.current();
      return undefined;
    }
    const reduced = plan.reduced;
    const phases = showcase.phases;
    const initialDestination = findMoveDestination(plan.event);
    const h = initialDestination?.offsetHeight || z.height;
    const w = initialDestination?.offsetWidth || z.width;
    const cx = z.left - o.left + z.width / 2;
    const cy = z.top - o.top + z.height / 2;
    const ownerSide = target.side;
    setSide(ownerSide);
    el.style.left = `${cx - w / 2}px`;
    el.style.top = `${cy - h / 2}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.setProperty("--fx-r", `${Math.max(2, w * 0.05)}px`);

    const box = showcaseBox({ width: o.width, height: o.height });
    const spot = { dx: box.cx - cx, dy: box.cy - cy, scale: box.height / h, height: box.height };
    const origin = showcase.origin;
    const from = plan.source?.rect;
    let start = { dx: spot.dx, dy: spot.dy, scale: spot.scale * 0.62 };
    let fadeIn = true;
    if (origin.kind === "strip") {
      start = {
        dx: origin.rect.left - o.left + origin.rect.width / 2 - cx,
        dy: origin.rect.top - o.top + origin.rect.height / 2 - cy,
        scale: Math.max(0.3, origin.rect.height / h),
      };
      fadeIn = false;
    } else if (origin.kind === "source" && from) {
      start = { dx: from.left - o.left + from.width / 2 - cx, dy: from.top - o.top + from.height / 2 - cy, scale: Math.max(0.3, from.height / h) };
      fadeIn = false;
    }
    const endRot = initialDestination ? Math.round(moveDestinationRotation(initialDestination) * 100) / 100 : ownerSide === "opp" ? 180 : 0;
    const frames = (end?: { dx: number; dy: number }) => buildShowcaseFrames({ phases, start, spot, end, endRot, reduced, fadeIn });

    // The label sits under the showcase card.
    const label = labelEl.current;
    if (label) {
      label.style.left = `${box.cx}px`;
      label.style.top = `${box.cy + box.height / 2 + Math.max(8, box.height * 0.04)}px`;
    }
    const stageMs = phases.riseMs + phases.holdMs;
    const track = new Track();
    let alive = true;
    const first = frames();
    const opts = (duration: number): KeyframeAnimationOptions => ({ duration, easing: "linear", fill: "both" });
    track.play(el, first.stage, opts(stageMs));
    track.play(aura.current, first.aura, opts(stageMs));
    track.play(label, first.label, opts(stageMs));

    let landedOnce = false;
    const land = () => {
      if (landedOnce) return;
      landedOnce = true;
      landedRef.current();
    };

    let flightEnd = { dx: 0, dy: 0 };
    let liveFlight: ReturnType<typeof retargetFlight> | undefined;
    track.after(stageMs, () => {
      if (!alive) return;
      const current = findMoveDestination(plan.event);
      const target = handArrivalTarget(plan.event);
      if (!target) { land(); doneRef.current(); return; }
      const now = target.rect;
      flightEnd = { dx: now.left - o.left + now.width / 2 - cx, dy: now.top - o.top + now.height / 2 - cy };
      const flightCx = cx + flightEnd.dx; const flightCy = cy + flightEnd.dy;
      // Rebase travel onto the current landing centre. The endpoint transform then has no
      // translation for the individual fan rotation to rotate away from its engine slot.
      const fly = reduced ? frames(flightEnd) : buildShowcaseFrames({ phases, start,
        spot: { ...spot, dx: spot.dx - flightEnd.dx, dy: spot.dy - flightEnd.dy }, endRot, reduced, fadeIn });
      if (!reduced) {
        el.style.left = `${flightCx - w / 2}px`;
        el.style.top = `${flightCy - h / 2}px`;
        flightEnd = { dx: 0, dy: 0 };
      }
      // A card goes into the opponent's hand face down unless the hand shows its face.
      const found = shownCode.current;
      track.play(el, fly.fly, opts(phases.flyMs));
      if (!reduced) {
        liveFlight = retargetFlight({ event: plan.event, el, overlay, cx: flightCx, cy: flightCy,
          duration: phases.flyMs, endRot, fallback: () => handArrivalTarget(plan.event)?.rect });
        track.onDispose(liveFlight.stop);
      }
      track.play(aura.current, fly.auraFly, opts(phases.flyMs));
      if (reduced) {
        if (found > 0 && flipper.current) flipper.current.style.transform = "rotateY(0deg)";
        land();
        return;
      }
      const faceAtEnd = found > 0 && (ownerSide === "you" || (current != null && artCodeOf(current) > 0));
      const a = showing.current;
      const b = faceAtEnd ? 0 : 180;
      if (a !== b) {
        track.play(
          flipper.current,
          [{ transform: `rotateY(${a}deg)`, offset: 0 }, { transform: `rotateY(${a}deg)`, offset: 0.3, easing: "ease-in-out" }, { transform: `rotateY(${b}deg)`, offset: 0.7 }, { transform: `rotateY(${b}deg)` }],
          opts(phases.flyMs),
        );
      }
    });
    const settle = () => {
      if (!alive) return;
      if (plan.handoff) { el.style.visibility = "hidden"; land(); doneRef.current(); return; }
      liveFlight?.finish();
      const current = findMoveDestination(plan.event);
      const target = handArrivalTarget(plan.event);
      if (!target) { land(); doneRef.current(); return; }
      const now = target.rect;
      land();
      if (reduced) {
        doneRef.current();
        return;
      }
      // The real card takes over under the ghost, which dissolves while the ring of light plays.
      track.play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: CARD_FX.landFadeMs, easing: "ease-out", fill: "both" });
      const r = ring.current;
      if (r && current) {
        r.style.left = `${now.left - o.left + now.width / 2 - w / 2}px`;
        r.style.top = `${now.top - o.top + now.height / 2 - h / 2}px`;
        r.style.width = `${w}px`;
        r.style.height = `${h}px`;
        r.style.rotate = `${moveDestinationRotation(current, true)}deg`;
        track.play(
          r,
          [
            { opacity: 0, transform: "scale(0.96)", offset: 0 },
            { opacity: 1, transform: "scale(1.03)", offset: 0.28, easing: "ease-out" },
            { opacity: 0, transform: "scale(1.06)", offset: 1 },
          ],
          { duration: phases.glowMs, easing: "ease-out", fill: "both" },
        );
      }
      if (current) track.onDispose(followMoveDestination(plan.event, (destination) => ({ destination,
        visible: destination?.getBoundingClientRect(), layer: overlay.getBoundingClientRect(),
        rotation: moveDestinationRotation(destination, true), width: destination?.offsetWidth, height: destination?.offsetHeight,
      }), ({ destination, visible, layer, rotation, width, height }) => {
        if (!destination) {
          el.style.visibility = "hidden";
          if (r) r.style.visibility = "hidden";
          return;
        }
        if (!visible) return;
        el.style.translate = "0px 0px";
        el.style.rotate = `${rotation - endRot}deg`;
        el.style.left = `${visible.left - layer.left + visible.width / 2 - w / 2 - flightEnd.dx}px`;
        el.style.top = `${visible.top - layer.top + visible.height / 2 - h / 2 - flightEnd.dy}px`;
        if (r) {
          const ringW = width || visible.width; const ringH = height || visible.height;
          r.style.left = `${visible.left - layer.left + visible.width / 2 - ringW / 2}px`;
          r.style.top = `${visible.top - layer.top + visible.height / 2 - ringH / 2}px`;
          r.style.width = `${ringW}px`;
          r.style.height = `${ringH}px`;
          r.style.rotate = `${rotation}deg`;
        }
      }));
      track.after(Math.max(phases.glowMs, CARD_FX.landFadeMs), () => doneRef.current());
    };
    track.after(stageMs + phases.flyMs, settle);
    return () => {
      alive = false;
      track.dispose();
    };
    // A showcase is immutable for its whole life: set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confirmations may arrive in a later snapshot while the original showcase is still running.
  useLayoutEffect(() => {
    const found = confirmedCard?.code;
    if (!found || shownCode.current > 0) return undefined;
    shownCode.current = found;
    showing.current = 0;
    setCode(found);
    setFullReady(false);
    const track = new Track();
    if (plan.reduced) {
      if (flipper.current) flipper.current.style.transform = "rotateY(0deg)";
    } else {
      track.play(flipper.current, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: REVEAL_FLIP_MS, easing: "ease-in-out", fill: "both" });
    }
    return () => track.dispose();
  }, [confirmedCard?.code, plan.reduced]);

  return (
    <>
      <div ref={ring} className={styles.ring} data-testid="added-ring" />
      <div
        ref={labelEl}
        className={styles.label}
        data-testid="added-label"
        role="presentation"
        style={{ opacity: 0 } as CSSProperties}
      >
        <span className={styles.title}>{ADDED_TITLE}</span>
        {source ? <span className={styles.source}>{source}</span> : null}
      </div>
      <div ref={root} className={fx.ghost} data-style="add" data-testid="added-ghost" data-known={code > 0 ? "true" : "false"} style={{ opacity: 0 } as CSSProperties}>
        <span ref={aura} className={styles.aura} style={{ opacity: 0 } as CSSProperties} />
        <div ref={flipper} className={fx.flipper} style={{ transform: `rotateY(${initialCode.current > 0 ? 0 : 180}deg)` }}>
          <div className={`${fx.face} ${styles.face}`}>
            {code > 0 ? (
              <>
                <img className={fx.art} src={cardArtUrl(code, "small")} alt="" draggable={false} />
                <img
                  className={`${fx.art} ${styles.full}`}
                  data-ready={fullReady ? "true" : "false"}
                  src={cardArtUrl(code, "full")}
                  alt=""
                  draggable={false}
                  onLoad={() => setFullReady(true)}
                />
              </>
            ) : null}
          </div>
          <div className={fx.back} data-sleeve={sleeve} style={{ transform: "rotateY(180deg)" }} />
        </div>
      </div>
    </>
  );
}
