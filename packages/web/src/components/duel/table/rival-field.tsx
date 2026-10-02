import type { CSSProperties } from "react";
import type { SeatFieldProps, SeatFieldRenderer, SeatPose } from "./types";
import styles from "./rival-field.module.css";

export interface RivalFieldProps {
  pose: SeatPose;
  /** Everything the seat field needs. `angleDeg` and `scale` come from the pose, so the caller leaves them out. */
  field: Omit<SeatFieldProps, "angleDeg" | "scale">;
  /** SeatField from field.tsx. A render prop, so this file does not import the duel field. */
  render: SeatFieldRenderer;
}

/** CSS transform of a seat box: its centre goes to the pose, then it tilts, turns and scales about its own centre. */
export function seatTransform(pose: Pick<SeatPose, "x" | "y" | "rotateDeg" | "tiltDeg" | "scale">): string {
  const tilt = pose.tiltDeg ?? 0;
  return [
    `translate(${pose.x}px, ${pose.y}px)`,
    "translate(-50%, -50%)",
    tilt ? `perspective(1700px) rotateX(${tilt}deg)` : "",
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
export function RivalField({ pose, field, render }: RivalFieldProps) {
  const style: CSSProperties & Record<string, string | number> = {
    "--sf-z": `${pose.z}px`,
    transform: seatTransform(pose),
    zIndex: Math.max(1, Math.round(pose.scale * 5)),
  };
  return (
    <div
      className={styles.seat}
      style={style}
      data-seat-slot={pose.seat}
      data-pose-scale={pose.scale}
      data-docked={pose.docked ? "true" : undefined}
      data-compact={pose.compact ? "true" : undefined}
      hidden={pose.hidden || undefined}
    >
      {render({ ...field, angleDeg: pose.rotateDeg, scale: pose.scale })}
    </div>
  );
}
