import type { CSSProperties } from "react";
import { slotZIndex } from "./geometry";
import { textScale } from "./seat-angle";
import type { SeatFieldProps, SeatFieldRenderer, SeatPose } from "./types";
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
  placement?: { left: number; top: number; zIndex: number; small?: boolean; lh?: number };
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
export function RivalField({ pose, field, render, angleOffsetDeg = 0, placement }: RivalFieldProps) {
  const style: CSSProperties & Record<string, string | number> = placement
    ? { "--sf-z": `${pose.z}px`, "--sf-ts": textScale(pose.scale).toFixed(2), ...(placement.lh != null ? { "--sf-lh": `${placement.lh}px` } : {}), left: placement.left, top: placement.top, rotate: pose.rotateDeg ? `${pose.rotateDeg}deg` : "none", zIndex: placement.zIndex }
    : { "--sf-z": `${pose.z}px`, transform: seatTransform(pose), zIndex: slotZIndex(pose.slot, pose.scale) };
  return (
    <div
      className={styles.seat}
      style={style}
      data-seat-slot={pose.seat}
      data-pose-scale={pose.scale}
      data-docked={pose.docked ? "true" : undefined}
      data-small={placement?.small ? "true" : undefined}
      hidden={pose.hidden || undefined}
    >
      {render(placement ? { ...field, angleDeg: pose.rotateDeg + angleOffsetDeg } : { ...field, angleDeg: pose.rotateDeg + angleOffsetDeg, scale: pose.scale })}
    </div>
  );
}
