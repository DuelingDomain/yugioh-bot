"use client";

import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { BOARD_H, buildCrumble, COL, ROW, type CrumbleCard, type Fall } from "./crumble-model";
import { hexToRgbTriplet } from "./seat-angle";
import { SEAT_TONE_HEX, type SeatTone } from "./types";
import styles from "./seat-crumble.module.css";

/** The mat face, drawn once per tone and width: one data-URI svg shared by every tile. */
const FACES = new Map<string, string>();

function matFace(tone: SeatTone, width: number): string {
  const key = `${tone}:${width}`;
  const known = FACES.get(key);
  if (known) return known;
  const rgb = hexToRgbTriplet(SEAT_TONE_HEX[tone].main).split(" ").join(",");
  const stretch = width / 653;
  let zones = "";
  const zone = (col: number, row: number) => {
    zones += `<rect x="${(COL[col] * stretch - 38.4).toFixed(1)}" y="${ROW[row] - 56}" width="76.8" height="112" rx="3.5" fill="rgba(239,231,213,.018)" stroke="rgba(181,153,99,.17)"/>`;
  };
  [1, 2, 3, 4, 5].forEach((col) => { zone(col, 1); zone(col, 2); });
  zone(2, 0); zone(4, 0); zone(0, 1); zone(6, 1); zone(0, 2); zone(6, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="380" viewBox="0 0 ${width} 380"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(10,17,34)" stop-opacity=".62"/><stop offset="1" stop-color="rgb(5,8,15)" stop-opacity=".58"/></linearGradient></defs>`
    + `<rect x=".5" y=".5" width="${width - 1}" height="379" rx="6" fill="url(#g)" stroke="rgba(${rgb},.45)"/><rect x="5.5" y="5.5" width="${width - 11}" height="369" rx="3" fill="none" stroke="rgba(181,153,99,.17)"/>`
    + `<path d="M14 9H${width - 14}M14 121H${width - 14}" stroke="rgba(181,153,99,.34)"/>${zones}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  FACES.set(key, url);
  return url;
}

const t3 = (x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
  `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;

export interface SeatCrumbleProps {
  /** The cards of the board in board px (see `crumbleCards`). The layer knows no table geometry. */
  cards: readonly CrumbleCard[];
  tone: SeatTone;
  /** The turn of the seat on the screen in degrees, and its scale: they set the direction of gravity. */
  rotateDeg: number;
  scale?: number;
  /** Width of the board in board px (the height is `BOARD_H`). */
  width: number;
  /** Seeds the shapes, so one seat crumbles the same way on every render. */
  seed?: number;
  /** No pieces: the flat board fades and slides down 28 px. */
  reducedMotion?: boolean;
  /** Called once every piece has landed. */
  onDone?: () => void;
}

/**
 * The elimination crumble of one seat board: the mat breaks into triangles along cracks, every card into six
 * shards, dust flies, and it all falls down the screen. It is self-contained: the caller puts it in a box of
 * `width` by `BOARD_H` board px at the place of the board and turns it like the board. The pieces move by
 * `transform` and `opacity` only (Web Animations API). The chain seat > layer > piece > clipped leaf keeps
 * `transform-style: preserve-3d` and has no opacity, filter or overflow above the leaf, or the depth is lost.
 * It draws nothing when the browser has no `animate`; the caller removes the layer on a timer as well.
 */
export function SeatCrumble({ cards, tone, rotateDeg, scale = 1, width, seed = 1234, reducedMotion = false, onDone }: SeatCrumbleProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  // The cards are the last board of the seat and never change while the layer shows.
  const spec = useMemo(
    () => buildCrumble(cards, { rotateDeg, scale }, width, seed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, rotateDeg, scale, seed],
  );
  const face = matFace(tone, width);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (reducedMotion || !box || typeof box.animate !== "function") return;
    const anims: Animation[] = [];
    const run = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const anim = el.animate(frames, { fill: "both", ...options });
      anims.push(anim);
      return anim;
    };
    const falls = [...spec.tiles, ...spec.shards].map((piece) => piece.fall);
    box.querySelectorAll<HTMLElement>("[data-fall]").forEach((el, index) => {
      const f: Fall = falls[index];
      run(el, [
        { transform: t3(0, 0, f.z0, 0, 0, 0), offset: 0 },
        { transform: t3(f.pop.x, f.pop.y, f.pop.z, f.pop.rx, f.pop.ry, f.pop.rz), offset: 0.14 },
        { transform: t3(f.to.x, f.to.y, f.to.z, f.to.rx, f.to.ry, f.to.rz), offset: 1 },
      ], { duration: f.dur, delay: f.delay, easing: "cubic-bezier(.5, 0, .9, .55)" });
      const leaf = el.firstElementChild;
      if (leaf) run(leaf, [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: f.dur, delay: f.delay, easing: "linear" });
    });
    box.querySelectorAll<SVGPathElement>("[data-crack]").forEach((path, index) => {
      run(path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 150, delay: spec.cracks[Math.floor(index / 2)].delay, easing: "ease-out" });
    });
    const cracks = box.querySelector("[data-cracks]");
    if (cracks) run(cracks, [{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 520, delay: 130, easing: "linear" });
    box.querySelectorAll<HTMLElement>("[data-dust]").forEach((el, index) => {
      const d = spec.dust[index];
      run(el, [
        { transform: "translate3d(0, 0, 6px)", opacity: 0 },
        { opacity: 0.9, offset: 0.15 },
        { transform: `translate3d(${d.to.x}px, ${d.to.y}px, ${d.to.z}px)`, opacity: 0 },
      ], { duration: d.dur, delay: d.delay, easing: "cubic-bezier(.3, .6, .5, 1)" });
    });
    let live = true;
    Promise.all(anims.map((anim) => anim.finished)).then(() => { if (live) done.current?.(); }, () => {});
    return () => {
      live = false;
      anims.forEach((anim) => anim.cancel());
    };
  }, [spec, reducedMotion]);

  const box: CSSProperties = { width: spec.width, height: BOARD_H };
  if (reducedMotion) {
    return (
      <div className={styles.flat} style={{ ...box, backgroundImage: face }} data-crumble="reduced" aria-hidden="true">
        {cards.map((card, index) => (
          <div
            key={index}
            className={card.back ? `${styles.piece} ${styles.back}` : styles.piece}
            style={{ left: card.x, top: card.y, width: card.w, height: card.h, backgroundImage: `url("${card.src}")` }}
          />
        ))}
      </div>
    );
  }
  return (
    <div ref={boxRef} className={styles.shatter} style={box} data-crumble aria-hidden="true">
      {spec.tiles.map((tile, index) => (
        <div key={`t${index}`} className={styles.sc} data-fall style={{ left: tile.left, top: tile.top, width: tile.w, height: tile.h }}>
          <div className={styles.ctile} style={{ clipPath: tile.clip }}>
            <div className={styles.tface} style={{ left: -tile.left, top: -tile.top, width: spec.width, height: spec.height, backgroundImage: face }} />
          </div>
        </div>
      ))}
      <svg className={styles.cracks} viewBox={`0 0 ${spec.width} ${spec.height}`} data-cracks>
        {spec.cracks.map((crack, index) => (
          <g key={index}>
            <path d={crack.d} className={styles.glow} data-crack pathLength={1} style={{ strokeDasharray: 1 }} />
            <path d={crack.d} className={styles.white} data-crack pathLength={1} style={{ strokeDasharray: 1 }} />
          </g>
        ))}
      </svg>
      {spec.shards.map((shard, index) => (
        <div
          key={`s${index}`}
          className={styles.sc}
          data-fall
          style={{ left: shard.left, top: shard.top, width: shard.w, height: shard.h, transformOrigin: shard.origin }}
        >
          <div
            className={shard.back ? `${styles.piece} ${styles.back}` : styles.piece}
            style={{ width: shard.w, height: shard.h, backgroundImage: `url("${shard.src}")`, clipPath: shard.clip }}
          />
        </div>
      ))}
      {spec.dust.map((d, index) => (
        <i key={`d${index}`} className={styles.dust} data-dust style={{ left: d.x, top: d.y, transform: "translateZ(6px)" }} />
      ))}
    </div>
  );
}
