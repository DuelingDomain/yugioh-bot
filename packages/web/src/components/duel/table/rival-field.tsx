import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { slotZIndex } from "./geometry";
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
  placement?: { left: number; top: number; zIndex: number; small?: boolean; lh?: number; boxX?: number };
  /** Seats are regrouping after an elimination: the move waits for the crumble, then glides slowly. */
  glide?: boolean;
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
export function RivalField({ pose, field, render, angleOffsetDeg = 0, placement, glide = false }: RivalFieldProps) {
  const style: CSSProperties & Record<string, string | number> = placement
    ? { "--sf-z": `${pose.z}px`, "--sf-ts": textScale(pose.scale).toFixed(2), ...(placement.lh != null ? { "--sf-lh": `${placement.lh}px` } : {}), ...(placement.boxX != null ? { "--sf-box-x": `${placement.boxX}px` } : {}), left: placement.left, top: placement.top, rotate: pose.rotateDeg ? `${pose.rotateDeg}deg` : "none", zIndex: placement.zIndex }
    : { "--sf-z": `${pose.z}px`, transform: seatTransform(pose), zIndex: slotZIndex(pose.slot, pose.scale) };
  return (
    <div
      className={styles.seat}
      style={style}
      data-seat-slot={pose.seat}
      data-pose-scale={pose.scale}
      data-docked={pose.docked ? "true" : undefined}
      data-small={placement?.small ? "true" : undefined}
      data-compact={pose.compact ? "true" : undefined}
      data-glide={glide ? "true" : undefined}
      hidden={pose.hidden || undefined}
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
  /** Called once when the layer can go. */
  onDone: () => void;
  /** A fixed place in the parent's px (the grid table), as on `RivalField`: the pose then only gives the card size. */
  placement?: { left: number; top: number; zIndex: number };
}

/**
 * The board of a seat that just left the duel, breaking apart at the pose it had. It replaces the live field, which the
 * engine has emptied: the cards are drawn from the last view. It is a plain box the size of a field, turned and scaled
 * like one, so it lines up with the pad under it. Under reduced motion it only fades down.
 */
export function ExitingSeat({ pose, tone, view, masterRule, faceUpHand, angleOffsetDeg = 0, reducedMotion, onDone, placement }: ExitingSeatProps) {
  const width = boardWidth(masterRule);
  const cards = useMemo(() => crumbleCards(view, { faceUpHand, width }), [view, faceUpHand, width]);
  const done = useRef(onDone);
  done.current = onDone;
  // The animation reports itself; this timer is for a browser with no animations and for reduced motion.
  useEffect(() => {
    const timer = setTimeout(() => done.current(), reducedMotion ? EXIT_CRUMBLE_REDUCED_MS : EXIT_CRUMBLE_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion]);
  const unit = pose.z / CRUMBLE_UNIT;
  const style: CSSProperties & Record<string, string | number> = {
    width: width * unit,
    height: CRUMBLE_UNIT * FIELD_H * unit,
    ...(placement
      ? { left: placement.left, top: placement.top, rotate: pose.rotateDeg ? `${pose.rotateDeg}deg` : "none", zIndex: placement.zIndex }
      : { transform: seatTransform(pose), zIndex: slotZIndex(pose.slot, pose.scale) + 1 }),
  };
  return (
    <div className={styles.seat} style={style} data-seat-exit={pose.seat} data-exit-motion={reducedMotion ? "reduced" : "full"} aria-hidden="true">
      <div className={styles.exitBoard} style={{ width, transform: `scale(${unit})` }}>
        <SeatCrumble
          cards={cards}
          tone={tone}
          rotateDeg={pose.rotateDeg + angleOffsetDeg}
          scale={pose.scale}
          width={width}
          seed={1234 + pose.seat * 13}
          reducedMotion={reducedMotion}
          onDone={() => done.current()}
        />
      </div>
    </div>
  );
}
