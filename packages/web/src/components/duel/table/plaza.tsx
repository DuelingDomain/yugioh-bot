import type { CSSProperties } from "react";
import { SEAT_TONE_HEX, type SeatPose, type TableLayout } from "./types";
import { hexToRgbTriplet } from "./seat-angle";
import { ARENA_CENTER, STAGE } from "./geometry";
import styles from "./plaza.module.css";

const SKYLINE_PATH =
  "M0 170V96h38V70h26v26h30V48h34v48h22V82h40V58h30v38h36V36h28v60h26V74h44V52h32v44h30V88h38V40h30v56h28V64h42v32h34V80h30V54h36v42h28V70h40V96h34V60h30v36h34V84h38v86z";

/**
 * The Battle City plaza under the fields, in stage px: a round floor with rings and radial seams, a pad of
 * the seat tone under each field, and a faint skyline with the arena sign at the top. Pure decoration:
 * it takes no pointer events and carries no game state. Drawn flat; the fly-in camera tilts it later.
 * `--spread` (set by the stage) is how far a wide box shows beyond the 1100 px stage at each side: the plaza grows by that much,
 * the floor and pads stay in the 1100 px space, and the skyline repeats (mirrored, so the seams meet) into the wings.
 */
export function Plaza({ layout, poses, fly = false }: { layout: TableLayout; poses: ReadonlyMap<number, SeatPose>; fly?: boolean }) {
  return (
    <div className={styles.plaza} data-plaza data-fly={fly ? "true" : undefined} aria-hidden="true">
      <div className={styles.space}>
        {[-1, 1].map((side) => (
          <svg key={side} className={styles.skyline} data-wing viewBox="0 0 1100 170" preserveAspectRatio="none" aria-hidden="true" style={{ left: side * STAGE.width, scale: "-1 1" }}>
            <path d={SKYLINE_PATH} fill="url(#plaza-sky)" stroke="rgb(181 153 99 / .18)" strokeWidth="1" />
          </svg>
        ))}
        <svg className={styles.skyline} viewBox="0 0 1100 170" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="plaza-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#10172a" />
              <stop offset="1" stopColor="#0a1020" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={SKYLINE_PATH} fill="url(#plaza-sky)" stroke="rgb(181 153 99 / .18)" strokeWidth="1" />
          <g transform="translate(517 18)">
            <rect width="66" height="17" rx="1.5" fill="#140c04" stroke="#e4b64f" strokeOpacity=".6" />
            <text x="33" y="12.5" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="2" fill="#ffe2a8">
              ARENA 07
            </text>
          </g>
        </svg>
        <div className={styles.floor} style={{ left: ARENA_CENTER.x, top: ARENA_CENTER.y }}>
          <span className={styles.rim} />
          <span className={styles.pool} />
        </div>
        {layout.slots.map((slot) => {
          const pose = poses.get(slot.seat);
          if (!pose || pose.hidden) return null;
          const style: CSSProperties & Record<string, string | number> = {
            left: pose.x,
            top: pose.y,
            "--t": hexToRgbTriplet(SEAT_TONE_HEX[slot.tone].main),
            rotate: `${pose.rotateDeg}deg`,
            scale: pose.scale,
          };
          return <span key={slot.seat} className={styles.pad} data-pad-seat={slot.seat} style={style} />;
        })}
      </div>
      <span className={styles.edge} />
    </div>
  );
}
