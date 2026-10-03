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
 * back. If the engine reveals it while it is on screen (the hand slot gets a face), it turns over.
 *
 * Reduced motion: no travel. The card fades in at the showcase spot with the label, holds, and fades
 * out as the real card shows in the hand.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cardArtUrl, LOCATION_EXTRA } from "./constants";
import { findMoveDestination, followMoveDestination, handArrivalTarget } from "./event-queue";
import { artCodeOf } from "./destroy-hide";
import { buildShowcaseFrames, showcaseBox, showcaseSourceLabel, ADDED_TITLE } from "./add-to-hand";
import { CARD_FX } from "./duel-timing";
import { Track } from "./summon-fx";
import type { MovePlan } from "./move-plan";
import fx from "./move-fx.module.css";
import styles from "./add-fx.module.css";

const CARD_ASPECT = 0.686;
/** How often the hand slot is checked for a face while the card is on show (a reveal has no event). */
const REVEAL_POLL_MS = 90;
const REVEAL_FLIP_MS = 340;

type Props = {
  plan: MovePlan;
  overlay: HTMLElement;
  /** The flight reached the hand: the real card may show. */
  landed: () => void;
  done: () => void;
};

export function ShowcaseGhost({ plan, overlay, landed, done }: Props) {
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
  const known = plan.event.card != null && plan.event.card.code > 0 ? plan.event.card.code : 0;
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
    const h = z.height;
    const w = Math.min(z.width, h * CARD_ASPECT);
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
    const endRot = ownerSide === "opp" ? 180 : 0;
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
    let shownCode = known;
    // The turn of the card as it shows now: 0 = face, 180 = back.
    let showing = known > 0 ? 0 : 180;
    const first = frames();
    const opts = (duration: number): KeyframeAnimationOptions => ({ duration, easing: "linear", fill: "both" });
    track.play(el, first.stage, opts(stageMs));
    track.play(aura.current, first.aura, opts(stageMs));
    track.play(label, first.label, opts(stageMs));

    // A reveal shows up as a face in the hand slot: turn the card over when it does.
    const turnOver = (found: number) => {
      shownCode = found;
      showing = 0;
      setCode(found);
      if (reduced) {
        if (flipper.current) flipper.current.style.transform = "rotateY(0deg)";
        return;
      }
      track.play(flipper.current, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: REVEAL_FLIP_MS, easing: "ease-in-out", fill: "both" });
    };
    const poll = window.setInterval(() => {
      if (!alive || shownCode > 0) return;
      const current = findMoveDestination(plan.event);
      const found = current ? artCodeOf(current) : 0;
      if (found > 0) turnOver(found);
    }, REVEAL_POLL_MS);
    track.onDispose(() => window.clearInterval(poll));

    let landedOnce = false;
    const land = () => {
      if (landedOnce) return;
      landedOnce = true;
      landedRef.current();
    };

    let flightEnd = { dx: 0, dy: 0 };
    track.after(stageMs, () => {
      if (!alive) return;
      window.clearInterval(poll);
      const current = findMoveDestination(plan.event);
      const target = handArrivalTarget(plan.event);
      if (!target) { land(); doneRef.current(); return; }
      const now = target.rect;
      flightEnd = { dx: now.left - o.left + now.width / 2 - cx, dy: now.top - o.top + now.height / 2 - cy };
      const fly = frames(flightEnd);
      // A card goes into the opponent's hand face down unless the hand shows its face.
      const found = shownCode > 0 ? shownCode : current ? artCodeOf(current) : 0;
      if (found > 0 && shownCode === 0) {
        shownCode = found;
        setCode(found);
      }
      track.play(el, fly.fly, opts(phases.flyMs));
      track.play(aura.current, fly.auraFly, opts(phases.flyMs));
      if (reduced) {
        if (found > 0 && flipper.current) flipper.current.style.transform = "rotateY(0deg)";
        land();
        return;
      }
      const faceAtEnd = found > 0 && (ownerSide === "you" || (current != null && artCodeOf(current) > 0));
      const a = showing;
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
      const current = findMoveDestination(plan.event);
      const target = handArrivalTarget(plan.event);
      if (!target) { land(); doneRef.current(); return; }
      const now = target.rect;
      const end = { dx: now.left - o.left + now.width / 2 - cx, dy: now.top - o.top + now.height / 2 - cy };
      if (!reduced && Math.hypot(end.dx - flightEnd.dx, end.dy - flightEnd.dy) >= 2) {
        const transform = (at: { dx: number; dy: number }) => `translate3d(${at.dx.toFixed(2)}px, ${at.dy.toFixed(2)}px, 0) rotate(${endRot}deg) scale(1)`;
        track.play(el, [{ transform: transform(flightEnd) }, { transform: transform(end) }], {
          duration: CARD_FX.glideMs, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both",
        });
        flightEnd = end;
        track.after(CARD_FX.glideMs, settle);
        return;
      }
      land();
      if (reduced) {
        doneRef.current();
        return;
      }
      // The real card takes over under the ghost, which dissolves while the ring of light plays.
      track.play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: CARD_FX.landFadeMs, easing: "ease-out", fill: "both" });
      const r = ring.current;
      if (r && current) {
        r.style.left = `${now.left - o.left}px`;
        r.style.top = `${now.top - o.top}px`;
        r.style.width = `${now.width}px`;
        r.style.height = `${now.height}px`;
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
      if (current) track.onDispose(followMoveDestination(plan.event, (destination) => {
        if (!destination) {
          el.style.visibility = "hidden";
          if (r) r.style.visibility = "hidden";
          return;
        }
        const visible = destination.getBoundingClientRect();
        const layer = overlay.getBoundingClientRect();
        el.style.left = `${visible.left - layer.left + visible.width / 2 - w / 2 - flightEnd.dx}px`;
        el.style.top = `${visible.top - layer.top + visible.height / 2 - h / 2 - flightEnd.dy}px`;
        if (r) {
          r.style.left = `${visible.left - layer.left}px`;
          r.style.top = `${visible.top - layer.top}px`;
          r.style.width = `${visible.width}px`;
          r.style.height = `${visible.height}px`;
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
        <div ref={flipper} className={fx.flipper} style={{ transform: `rotateY(${known > 0 ? 0 : 180}deg)` }}>
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
