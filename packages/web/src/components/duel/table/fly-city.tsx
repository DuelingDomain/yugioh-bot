"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import styles from "./fly-city.module.css";

/**
 * The Battle City around the plaza, seen only in the fly-in camera: an asphalt disc, the walk ring, three avenues,
 * street lamps with light pools, and standing towers. It lives in the world (a 3D context) at 0.64 scale, so the
 * plaza reads as a small arena inside a large city. Pure decoration: no pointer events, no game state.
 */

const AVENUES = [60, 180, 300];
const HEIGHTS = [440, 640, 380, 720, 520];
const HALF = 1600;

/** Window lights as a canvas picture. Seeded, so a city looks the same on every load. Empty where no canvas exists. */
export function windowTexture(seed: number, w: number, h: number, warm: boolean): string {
  if (typeof document === "undefined") return "";
  let g: CanvasRenderingContext2D | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    g = canvas.getContext("2d");
  } catch {
    return "";
  }
  if (!g || !canvas) return "";
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#121828");
  grad.addColorStop(1, "#090c15");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const cw = 16;
  const ch = 22;
  const gx = 10;
  const gy = 14;
  for (let y = 26; y < h - 30; y += ch + gy) {
    for (let x = 14; x < w - 20; x += cw + gx) {
      const r = rnd();
      if (r < 0.2) {
        g.fillStyle = warm
          ? `rgba(255,${190 + ((rnd() * 40) | 0)},${110 + ((rnd() * 40) | 0)},${0.55 + rnd() * 0.4})`
          : `rgba(${150 + ((rnd() * 40) | 0)},${180 + ((rnd() * 40) | 0)},255,${0.4 + rnd() * 0.4})`;
      } else if (r < 0.32) g.fillStyle = "rgba(155,126,255,.22)";
      else g.fillStyle = "rgba(0,0,0,.55)";
      g.fillRect(x, y, cw, ch);
    }
  }
  g.fillStyle = "rgba(255,255,255,.05)";
  for (let x = 0; x < w; x += cw + gx) g.fillRect(x + 10, 0, 1, h);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

const cityPoint = (angleDeg: number, distance: number) => {
  const a = (angleDeg * Math.PI) / 180;
  return { x: -Math.sin(a) * distance, y: Math.cos(a) * distance };
};

interface Tower {
  key: string;
  angle: number;
  radius: number;
  width: number;
  height: number;
  tex: number;
  shift: number;
  mark: "screen" | "sign" | null;
}

/** The transform that stands a tower on the floor at `angle` and `radius` from the arena centre. */
export function standingTransform(angle: number, radius: number, width: number, height: number): string {
  return `rotate(${angle + 180}deg) translateY(${-radius}px) rotateX(-90deg) translate(${-width / 2}px, ${-height}px)`;
}

function towers(): Tower[] {
  const list: Tower[] = [];
  let n = 0;
  for (const seg of [0, 120, 240]) {
    const a0 = seg - 46;
    const a1 = seg + 46;
    const count = 5;
    for (let j = 0; j < count; j++) {
      const angle = a0 + ((a1 - a0) * (j + 0.5)) / count;
      const radius = 1010 + (j % 2) * 55;
      const width = 2 * radius * Math.sin((((a1 - a0) / count / 2) * Math.PI) / 180) + 8;
      list.push({
        key: `seg-${seg}-${j}`,
        angle,
        radius,
        width,
        height: HEIGHTS[(j + n) % 5],
        tex: (j + n) % 3,
        shift: (j * 97) % 420,
        mark: seg === 120 && j === 3 ? "screen" : seg === 240 && j === 1 ? "sign" : null,
      });
    }
    n++;
  }
  AVENUES.forEach((angle, ix) => {
    for (const side of [-1, 1]) {
      list.push({ key: `ave-${angle}-${side}`, angle: angle + side * 17, radius: 1230, width: 240, height: side > 0 ? 820 : 600, tex: (ix + side + 3) % 3, shift: 0, mark: null });
    }
  });
  return list;
}

export function FlyCity({ title = "3-WAY DUEL" }: { title?: string } = {}) {
  // The textures come from a canvas, which the server cannot draw: the city mounts after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <FlyCityBody />;
}

function FlyCityBody() {
  const textures = useMemo(() => [windowTexture(7, 420, 900, true), windowTexture(31, 420, 900, false), windowTexture(77, 420, 900, true)], []);
  const lamps = useMemo(() => {
    const list: { key: number; x: number; y: number }[] = [];
    for (let a = 30; a < 360; a += 40) {
      if (AVENUES.some((v) => Math.abs((((a - v + 540) % 360) + 360) % 360 - 180) < 16)) continue;
      const p = cityPoint(a, 915);
      list.push({ key: a, x: HALF + p.x, y: HALF + p.y });
    }
    return list;
  }, []);
  const list = useMemo(towers, []);
  return (
    <div className={styles.city} data-fly-city aria-hidden="true">
      <div className={styles.floor}>
        <div className={styles.asphalt} />
        <div className={styles.walk} />
        {AVENUES.map((angle) => (
          <div key={angle} className={styles.avenue} style={{ transform: `rotate(${angle + 180}deg)` }} />
        ))}
        {lamps.map((lamp) => (
          <span key={lamp.key}>
            <i className={styles.pool} style={{ left: lamp.x - 260, top: lamp.y - 260 }} />
            <i className={styles.lamp} style={{ left: lamp.x - 9, top: lamp.y - 9 }} />
          </span>
        ))}
      </div>
      {list.map((tower) => {
        const tex = textures[tower.tex];
        const style: CSSProperties = {
          width: tower.width,
          height: tower.height,
          transform: standingTransform(tower.angle, tower.radius, tower.width, tower.height),
          backgroundImage: tex ? `url(${tex})` : undefined,
          backgroundSize: "420px 900px",
          backgroundPosition: `${tower.shift}px bottom`,
        };
        return (
          <div key={tower.key} className={styles.bld} style={style}>
            {tower.mark === "screen" ? (
              <div className={styles.screen}>
                <div>
                  {title}<small>LIVE · FINALS</small>
                </div>
              </div>
            ) : null}
            {tower.mark === "sign" ? <div className={styles.sign}>ARENA 07</div> : null}
          </div>
        );
      })}
    </div>
  );
}
