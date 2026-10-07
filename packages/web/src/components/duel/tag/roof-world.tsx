import { Fragment, type CSSProperties } from "react";
import { tagSeatCode } from "../table-format";
import type { BatonStop } from "./tag-logic";
import { ROOF_FIELD } from "./roof-camera";
import styles from "./tag-stage.module.css";

/**
 * The static world of the Rooftop: city below, towers, roof slab, parapet, helipad, props and the neon sign.
 * Everything here is plain DOM and CSS (no canvas), so it renders the same in a test and in a browser.
 * World units are the prototype's: the roof is 2100 by 1800 centred on the helipad (0, 0), z grows toward the camera.
 */

export const ROOF_SLAB = { width: 2100, height: 1800 } as const;
const PARAPET = 34;
/** Strip margin round a field and the helipad scale: the pad is a small mark in the gap between the strips. */
const STRIP_EDGE = ROOF_FIELD.offsetY - 16;
const PAD_SCALE = 0.3;

interface Tower {
  x: number;
  y: number;
  w: number;
  h: number;
  top: number;
  face: number; // rotateZ of the standing plane, deg
  blink?: boolean;
}

/** Thirteen towers around the roof, tops below the parapet. Faces point at the helipad. */
const TOWERS: readonly Tower[] = [
  { x: -980, y: -1250, w: 360, h: 760, top: -110, face: 0 },
  { x: -420, y: -1330, w: 300, h: 900, top: -180, face: 0, blink: true },
  { x: 120, y: -1290, w: 420, h: 820, top: -90, face: 0 },
  { x: 700, y: -1360, w: 320, h: 980, top: -240, face: 0, blink: true },
  { x: 1190, y: -1240, w: 380, h: 700, top: -120, face: 0 },
  { x: -1380, y: -380, w: 330, h: 820, top: -150, face: 90 },
  { x: -1420, y: 420, w: 380, h: 700, top: -90, face: 90, blink: true },
  { x: 1400, y: -420, w: 340, h: 780, top: -130, face: -90 },
  { x: 1440, y: 380, w: 360, h: 900, top: -200, face: -90 },
  { x: -900, y: 1250, w: 380, h: 740, top: -100, face: 180 },
  { x: -300, y: 1330, w: 320, h: 860, top: -160, face: 180, blink: true },
  { x: 380, y: 1280, w: 400, h: 780, top: -110, face: 180 },
  { x: 1000, y: 1350, w: 340, h: 940, top: -220, face: 180 },
];

const PADS = Array.from({ length: 12 }, (_, i) => i);

export function RoofDecor() {
  const { width: rw, height: rh } = ROOF_SLAB;
  return (
    <>
      <div className={styles.city} data-roof="city" style={{ left: -2600, top: -2600, width: 5200, height: 5200, transform: "translateZ(-760px)", backgroundImage: CITY_LIGHTS }} />
      {TOWERS.map((t, i) => (
        <div
          key={i}
          className={styles.tower}
          data-roof="tower"
          style={{
            width: t.w,
            height: t.h,
            marginLeft: -t.w / 2,
            transform: `translate3d(${t.x}px, ${t.y}px, ${t.top}px) rotateZ(${t.face}deg) rotateX(-90deg)`,
            backgroundImage: WINDOWS,
            backgroundPosition: `${(i * 37) % 60}px ${(i * 53) % 50}px`,
          }}
        >
          {t.blink ? <span className={styles.blink} /> : null}
        </div>
      ))}
      <div className={styles.roof} data-roof="slab" style={{ left: -rw / 2, top: -rh / 2, width: rw, height: rh }} />
      <div className={styles.wall} style={{ left: 0, top: 0, width: rw, height: PARAPET, transform: `translate3d(${-rw / 2}px, ${-rh / 2}px, ${PARAPET}px) rotateX(-90deg)` }} />
      <div className={styles.wall} style={{ left: 0, top: 0, width: rw, height: PARAPET, transform: `translate3d(${rw / 2}px, ${rh / 2}px, ${PARAPET}px) rotateZ(180deg) rotateX(-90deg)` }} />
      <div className={styles.wall} style={{ left: 0, top: 0, width: rh, height: PARAPET, transform: `translate3d(${-rw / 2}px, ${rh / 2}px, ${PARAPET}px) rotateZ(-90deg) rotateX(-90deg)` }} />
      <div className={styles.wall} style={{ left: 0, top: 0, width: rh, height: PARAPET, transform: `translate3d(${rw / 2}px, ${-rh / 2}px, ${PARAPET}px) rotateZ(90deg) rotateX(-90deg)` }} />
      <div className={styles.under} style={{ left: -760, top: STRIP_EDGE - 24, width: 1520, height: 460, transform: "translateZ(0.5px)", background: "linear-gradient(90deg, rgb(155 126 255 / 0.7), rgb(92 184 245 / 0.7))" }} />
      <div className={styles.under} style={{ left: -760, top: -STRIP_EDGE + 24 - 460, width: 1520, height: 460, transform: "translateZ(0.5px)", background: "linear-gradient(90deg, rgb(240 140 196 / 0.7), rgb(143 211 107 / 0.7))" }} />
      <svg className={styles.pad} data-roof="pad" width={560} height={560} viewBox="-280 -280 560 560" style={{ left: -280, top: -280, transform: `translateZ(1px) scale(${PAD_SCALE})`, transformOrigin: "50% 50%" }} aria-hidden="true">
        <circle r={232} fill="rgb(10 14 26 / 0.8)" stroke="rgb(228 182 79 / 0.55)" strokeWidth={5} />
        <circle r={212} fill="none" stroke="rgb(239 231 213 / 0.28)" strokeWidth={3} strokeDasharray="22 14" />
        <text x={0} y={52} textAnchor="middle" fontSize={150} fontWeight={700} fill="rgb(228 182 79 / 0.32)" style={{ fontFamily: "var(--disp)" }}>H</text>
        <defs>
          <path id="tag-pad-arc" d="M -190 0 A 190 190 0 1 1 190 0 A 190 190 0 1 1 -190 0" />
        </defs>
        <text fontSize={19} letterSpacing={7} fill="rgb(239 231 213 / 0.38)" style={{ fontFamily: "var(--ui)", fontWeight: 600 }}>
          <textPath href="#tag-pad-arc" startOffset="0">SKYDECK 48 · TAG NIGHT · SKYDECK 48 · TAG NIGHT ·</textPath>
        </text>
        {PADS.map((i) => {
          const a = (i / PADS.length) * Math.PI * 2;
          return (
            <circle
              key={i}
              className={styles.padLight}
              cx={+(Math.cos(a) * 246).toFixed(2)}
              cy={+(Math.sin(a) * 246).toFixed(2)}
              r={6}
              fill="rgb(255 214 150)"
              style={{ animationDelay: `${(i * 0.2).toFixed(1)}s` }}
            />
          );
        })}
      </svg>
      {AC_BOXES.map(([x, y], i) => (
        <Fragment key={i}>
          <div className={styles.acshade} style={{ left: x - 80, top: y - 50, width: 190, height: 130, transform: "translateZ(0.8px)" }} />
          <div className={styles.acbox} data-roof="prop" style={{ left: x - 70, top: y - 50, width: 140, height: 100, transform: "translateZ(30px)" }} />
        </Fragment>
      ))}
      <div className={styles.prop} style={{ left: -0, top: 0, width: 12, height: 300, marginLeft: -6, background: "linear-gradient(90deg, #202738, #3a4357)", transform: `translate3d(-980px, -120px, 300px) rotateX(-90deg)` }} />
      <span className={styles.blink} style={{ left: 0, top: 0, width: 16, height: 16, margin: 0, transform: "translate3d(-988px, -128px, 302px)" }} />
      <div className={styles.sign} data-roof="sign" style={{ left: -520, top: 0, width: 1040, height: 220, transform: `translate3d(0px, ${-rh / 2 - 30}px, 250px) rotateX(-90deg)` }}>
        <div className={styles.neon}>SKYDECK 48<small>TAG NIGHT</small></div>
      </div>
      <div className={styles.sign} style={{ left: -520, top: 0, width: 1040, height: 220, transform: `translate3d(0px, ${rh / 2 + 30}px, 250px) rotateZ(180deg) rotateX(-90deg)` }}>
        <div className={styles.neon}>SKYDECK 48<small>TAG NIGHT</small></div>
      </div>
    </>
  );
}

const AC_BOXES: ReadonlyArray<readonly [number, number]> = [[-940, -380], [930, -330], [-960, 420], [950, 470]];

const CITY_LIGHTS = [
  "radial-gradient(circle, rgb(255 214 150 / 0.85) 0 2px, transparent 3px)",
  "radial-gradient(circle, rgb(120 190 255 / 0.7) 0 2px, transparent 3px)",
  "radial-gradient(circle, rgb(255 120 140 / 0.6) 0 2.5px, transparent 3.5px)",
  "linear-gradient(0deg, rgb(255 255 255 / 0.04) 0 2px, transparent 2px)",
].join(", ");

const WINDOWS = [
  "repeating-linear-gradient(90deg, transparent 0 18px, rgb(10 14 25 / 0.95) 18px 26px)",
  "repeating-linear-gradient(0deg, rgb(255 214 150 / 0.55) 0 7px, transparent 7px 22px)",
  "repeating-linear-gradient(0deg, transparent 0 22px, rgb(120 190 255 / 0.28) 22px 29px, transparent 29px 66px)",
].join(", ");

/* ---------- baton ---------- */

const NOTCH_Y = Math.round(ROOF_FIELD.offsetY * 0.5);
const NOTCH: ReadonlyArray<readonly [number, number]> = [[-610, NOTCH_Y], [-610, -NOTCH_Y], [610, NOTCH_Y], [610, -NOTCH_Y]];

export interface BatonProps {
  stops: readonly BatonStop[];
  anchorSeat: number;
  nameOf: (seat: number) => string;
  rgbOf: (seat: number) => string; // "r g b" triplet of the seat colour
  out: ReadonlySet<number>;
  /** The stage sets --flip on the holder while the camera looks from the rival end, so the pills read upright. */
  holderRef?: (node: HTMLDivElement | null) => void;
}

function stopAt(anchor: number, k: number): number {
  return (anchor + k) % 4;
}

/** The bow-tie baton on the helipad: one pill per seat, turn order 1A to 2A to 1B to 2B. */
export function Baton({ stops, anchorSeat, nameOf, rgbOf, out, holderRef }: BatonProps) {
  const notchOf = (seat: number) => (seat - anchorSeat + 4) % 4;
  const now = stops.find((s) => s.now);
  const next = stops.find((s) => s.next);
  const seg = now && next ? [NOTCH[notchOf(now.seat)], NOTCH[notchOf(next.seat)]] : null;
  const ring = [0, 1, 2, 3].map((k) => NOTCH[k]);
  return (
    <>
      <svg className={styles.baton} data-roof="baton" width={1400} height={440} viewBox="-700 -220 1400 440" style={{ left: -700, top: -220, transform: "translateZ(1.5px)" }} aria-hidden="true">
        <path d={`M ${ring.map((p) => p.join(",")).join(" L ")} Z`} fill="none" stroke="rgb(239 231 213 / 0.28)" strokeWidth={4} strokeDasharray="18 12" strokeLinejoin="round" />
        {seg ? (
          <line x1={seg[0][0]} y1={seg[0][1]} x2={seg[1][0]} y2={seg[1][1]} stroke={`rgb(${rgbOf(now!.seat)})`} strokeWidth={8} strokeLinecap="round" opacity={0.85} />
        ) : null}
      </svg>
      <div ref={holderRef} className={styles.bpills} data-roof="baton-pills" style={{ left: 0, top: 0, transform: "translateZ(2px)" }}>
        {[0, 1, 2, 3].map((k) => {
          const seat = stopAt(anchorSeat, k);
          const stop = stops.find((s) => s.seat === seat);
          const isOut = out.has(seat);
          const state = isOut ? "out" : stop?.now ? "now" : stop?.next ? "next" : "";
          const style = { transform: `translate(${NOTCH[k][0]}px, ${NOTCH[k][1]}px) rotate(var(--flip, 0deg))`, ["--c" as string]: rgbOf(seat) } as CSSProperties;
          return (
            <div key={seat} className={styles.bpill} data-seat={seat} data-state={state || undefined} data-out={isOut ? "true" : undefined} style={style}>
              <b>{stop?.code ?? tagSeatCode("tag", seat) ?? ""}</b>
              <span>{nameOf(seat).split(" ")[0].toUpperCase()}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- team strip ---------- */

export interface TeamStripProps {
  /** Near strip sits at +y facing up; the far strip is the same strip turned 180 degrees. */
  near: boolean;
  glyph: "◆" | "●";
  teamName: string;
  out: boolean;
  children?: never;
}

/** The strip under one team's two fields: rim lines, the seam between the members, the bond line and the medal. */
export function TeamStrip({ near, glyph, teamName, out }: TeamStripProps) {
  const transform = near ? "translateZ(1px)" : `translateZ(1px) rotate(180deg) translate(-708px, ${STRIP_EDGE}px)`;
  const place = near ? { left: -708, top: STRIP_EDGE } : { left: 0, top: 0 };
  return (
    <div
      className={styles.strip}
      data-strip={near ? "near" : "far"}
      data-team={near ? 0 : 1}
      data-out={out ? "true" : undefined}
      aria-label={`${teamName} strip`}
      style={{ ...place, width: 1416, height: 412, transform }}
    >
      <span className={styles.rimline} />
      <span className={styles.rimline} data-edge="b" />
      <span className={styles.bond} style={{ left: 328, width: 760 }} />
      <span className={styles.seam} style={{ left: 688, width: 40 }}>
        <b>TEAM</b>
      </span>
      <span className={styles.medal} style={{ left: 708 }}>
        <i>{glyph}</i>
      </span>
    </div>
  );
}
