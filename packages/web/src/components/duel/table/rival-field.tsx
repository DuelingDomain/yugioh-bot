import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { slotZIndex } from "./geometry";
import { duelFxClock } from "../fx-clock";
import { CRUMBLE_GATE_CAP_MS, CRUMBLE_GATE_TICK_MS, beginCrumbleWait, crumbleMayStart, pauseRegroup } from "./crumble-gate";
import { boardWidth, crumbleCards } from "./crumble-model";
import { textScale } from "./seat-angle";
import { SeatCrumble } from "./seat-crumble";
import type { DuelSeatView } from "@yugidraft/shared/duels";
import type { SeatFieldProps, SeatFieldRenderer, SeatPose, SeatTone } from "./types";
import styles from "./rival-field.module.css";

export interface RivalFieldProps {
  pose: SeatPose;
  /** Everything the seat field needs. `angleDeg` and `scale` come from the pose, so the caller leaves them out. */
  field: Omit<SeatFieldProps, "angleDeg" | "scale">;
  /** SeatField from field.tsx. A render prop, so this file does not import the duel field. */
  render: SeatFieldRenderer;
  /** Extra turn of the whole world (the fly-in view), added to the angle the field reads for upright text. */
  angleOffsetDeg?: number;
  /**
   * A fixed place in the parent's px (the grid table): the box sits at `left`/`top` and turns with the CSS `rotate`
   * property. `transform` stays free for the stage to animate. `pose.x/y/scale` are not used; `pose.z` is the card height.
   */
  placement?: { left: number; top: number; zIndex: number; small?: boolean; lh?: number; boxX?: number; handShift?: number; handWidth?: number };
  /** Seats are regrouping after an elimination: the move waits for the crumble, then glides slowly. */
  glide?: boolean;
  /** This field is the one the viewer enlarged (the 3-way plaza). */
  enlarged?: boolean;
  /** The seat box is a keyboard stop (the 3-way plaza): Enter or Space on the box itself enlarges it or goes back. */
  reach?: { label: string; onToggle: () => void };
  /** This field holds the targets the viewer must pick: a ring on the field, with no camera move. */
  targeted?: boolean;
}

/** CSS transform of a seat box: its centre goes to the pose, then it tilts, turns and scales about its own centre. */
export function seatTransform(pose: Pick<SeatPose, "x" | "y" | "rotateDeg" | "tiltDeg" | "scale">): string {
  const tilt = pose.tiltDeg ?? 0;
  return [
    `translate(${pose.x}px, ${pose.y}px)`,
    "translate(-50%, -50%)",
    pose.tiltDeg != null ? `perspective(1700px) rotateX(${tilt}deg)` : "",
    `rotate(${pose.rotateDeg}deg)`,
    `scale(${pose.scale})`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * One seat of the table at its pose. The wrapper owns the place, tilt, turn and scale; the seat field inside
 * draws the board at a fixed card size (`--sf-z`) and counter-rotates its own text when upright is on.
 * It serves the viewer's own seat too: that pose is simply upright at full size.
 */
export function RivalField({ pose, field, render, angleOffsetDeg = 0, placement, glide = false, enlarged = false, reach, targeted = false }: RivalFieldProps) {
  const style: CSSProperties & Record<string, string | number> = placement
    ? { "--sf-z": `${pose.z}px`, "--sf-ts": textScale(pose.scale).toFixed(2), ...(placement.lh != null ? { "--sf-lh": `${placement.lh}px` } : {}), ...(placement.boxX != null ? { "--sf-box-x": `${placement.boxX}px` } : {}), ...(placement.handShift != null ? { "--hand-shift": placement.handShift } : {}), ...(placement.handWidth != null ? { "--hand-w": placement.handWidth } : {}), left: placement.left, top: placement.top, rotate: pose.rotateDeg ? `${pose.rotateDeg}deg` : "none", zIndex: placement.zIndex }
    : { "--sf-z": `${pose.z}px`, "--sk": `calc(var(--stage-k, 1) * ${pose.scale})`, transform: seatTransform(pose), zIndex: slotZIndex(pose.slot, pose.scale) };
  return (
    <div
      className={styles.seat}
      style={style}
      data-seat-slot={pose.seat}
      data-pose-scale={pose.scale}
      data-def-full={pose.width ? "true" : undefined}
      data-docked={pose.docked ? "true" : undefined}
      data-small={placement?.small ? "true" : undefined}
      data-compact={pose.compact ? "true" : undefined}
      data-glide={glide ? "true" : undefined}
      data-enlarged={enlarged ? "true" : undefined}
      data-target-hint={targeted ? "true" : undefined}
      hidden={pose.hidden || undefined}
      {...(reach
        ? {
            role: "button",
            tabIndex: 0,
            "aria-pressed": enlarged,
            "aria-label": `${reach.label}. ${enlarged ? "Press Enter to go back." : "Press Enter to enlarge."}`,
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              // Keys of the controls inside the field stay theirs.
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              event.stopPropagation();
              reach.onToggle();
            },
          }
        : {})}
    >
      {render(placement ? { ...field, angleDeg: pose.rotateDeg + angleOffsetDeg } : { ...field, angleDeg: pose.rotateDeg + angleOffsetDeg, scale: pose.scale })}
    </div>
  );
}

/** Card unit the crumble is drawn in (the board is 5.83 of them wide at this size). */
const CRUMBLE_UNIT = 112;
/** Height of a seat field in card units (see `.seatField` in field.module.css). */
const FIELD_H = 3.393;

/** How long the crumble of a seat that left plays: the animation, and the timer for a browser with none. */
export const EXIT_CRUMBLE_MS = 1600;
export const EXIT_CRUMBLE_REDUCED_MS = 520;

export interface ExitingSeatProps {
  /** The pose the seat had before it left. */
  pose: SeatPose;
  tone: SeatTone;
  /** The last board of the seat, from before the engine emptied it. */
  view: DuelSeatView;
  masterRule?: number;
  /** The viewer's own hand shows faces; a rival's shows backs. */
  faceUpHand: boolean;
  /** Extra turn of the world (the fly-in view), so gravity stays down on the screen. */
  angleOffsetDeg?: number;
  reducedMotion: boolean;
  /** Cut the top of the board this many px (in the board's own turn): the 4-way grid keeps the shared Extra Monster row. */
  clipTop?: number;
  /** Called once when the layer can go. */
  onDone: () => void;
}

/**
 * The board of a seat that just left the duel, breaking apart at the pose it had. It replaces the live field, which the
 * engine has emptied: the cards are drawn from the last view. It is a plain box the size of a field, turned and scaled
 * like one, so it lines up with the pad under it. Under reduced motion it only fades down.
 */
export function ExitingSeat({ pose, tone, view, masterRule, faceUpHand, angleOffsetDeg = 0, reducedMotion, clipTop, onDone }: ExitingSeatProps) {
  const width = pose.width ?? boardWidth(masterRule);
  const cards = useMemo(() => crumbleCards(view, { faceUpHand, width }), [view, faceUpHand, width]);
  const done = useRef(onDone);
  done.current = onDone;
  // The board waits whole until the attack, the damage and the LP roll that put the seat out are over (crumble-gate.ts).
  const [held, setHeld] = useState(true);
  useEffect(() => {
    if (!held) return undefined;
    const startedAt = duelFxClock.dateNow();
    const end = beginCrumbleWait();
    // The glide of the seats that stay waits too: it is paused once its transition has begun (a frame or two on).
    let resume: (() => void) | null = null;
    const frames: number[] = [];
    frames.push(window.requestAnimationFrame(() => frames.push(window.requestAnimationFrame(() => { resume = pauseRegroup(); }))));
    const timer = setInterval(() => {
      if (!crumbleMayStart() && duelFxClock.dateNow() - startedAt < CRUMBLE_GATE_CAP_MS) return;
      clearInterval(timer);
      resume?.();
      end();
      setHeld(false);
    }, CRUMBLE_GATE_TICK_MS);
    return () => {
      clearInterval(timer);
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      // A seat that goes while it waits lets the glide and the finale go on.
      resume?.();
      end();
    };
  }, [held]);
  // The animation reports itself; this timer is for a browser with no animations and for reduced motion.
  useEffect(() => {
    if (held) return undefined;
    const timer = setTimeout(() => done.current(), reducedMotion ? EXIT_CRUMBLE_REDUCED_MS : EXIT_CRUMBLE_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion, held]);
  const unit = pose.z / CRUMBLE_UNIT;
  const style: CSSProperties & Record<string, string | number> = {
    width: width * unit,
    height: CRUMBLE_UNIT * FIELD_H * unit,
    transform: seatTransform(pose),
    zIndex: slotZIndex(pose.slot, pose.scale) + 1,
    ...(clipTop != null ? { clipPath: `inset(${clipTop}px -600px -600px -600px)` } : {}),
  };
  return (
    <div className={styles.seat} style={style} data-seat-exit={pose.seat} data-exit-motion={reducedMotion ? "reduced" : "full"} data-exit-held={held ? "true" : undefined} aria-hidden="true">
      <div className={styles.exitBoard} style={{ width, transform: `scale(${unit})` }}>
        <SeatCrumble
          cards={cards}
          tone={tone}
          rotateDeg={pose.rotateDeg + angleOffsetDeg}
          scale={pose.scale}
          width={width}
          seed={1234 + pose.seat * 13}
          reducedMotion={reducedMotion}
          held={held}
          onDone={() => done.current()}
        />
      </div>
    </div>
  );
}
