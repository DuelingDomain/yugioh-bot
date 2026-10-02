"use client";

import { useEffect, useRef, type RefObject } from "react";
import { normalizeAngle, type FlyWorld } from "./geometry";
import { SEAT_TONE_HEX, type SeatTone } from "./types";
import { hexToRgbTriplet } from "./seat-angle";

/**
 * The world of the fly-in view, driven from outside React: a tween of the world transform and, while the view is
 * on, a per-frame pump that puts each holo LP panel beside its projected seat and draws the tether lines.
 * The pump reads the live DOM (`getBoundingClientRect`), because the seats move by CSS transitions inside a 3D
 * world. It writes only `style.transform` of `[data-holo]`, `--ry` of the ring, and the tether svg.
 */

export const WORLD_ID: FlyWorld = { yawDeg: 0, tiltDeg: 0, zoom: 1, fx: 0, fy: 0, oy: 0 };
const DURATION_MS = 950;
const easeOut4 = (t: number) => 1 - Math.pow(1 - t, 4);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The CSS transform of a world pose. Empty at identity, so a flat view has no 3D layer. */
export function worldTransform(w: FlyWorld): string {
  if (!w.tiltDeg && !w.yawDeg && w.zoom === 1 && !w.fx && !w.fy && !w.oy) return "";
  return `translate3d(0,${w.oy.toFixed(2)}px,0) scale3d(${w.zoom},${w.zoom},${w.zoom}) rotateX(${w.tiltDeg.toFixed(2)}deg) rotateZ(${w.yawDeg.toFixed(2)}deg) translate3d(${(-w.fx).toFixed(2)}px,${(-w.fy).toFixed(2)}px,0)`;
}

export interface FlyWorldOptions {
  /** The fly-in view is shown (the effective camera, so a lock that sends the plaza home turns it off). */
  active: boolean;
  /** The world pose of the shown camera. */
  target: FlyWorld;
  /** The player is orbiting or zooming: follow at once, no tween. */
  free: boolean;
  reducedMotion: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
  tetherRef: RefObject<SVGSVGElement | null>;
  /** Seat of the viewer's hand row and the seat the camera has flown to (its panel is the only one shown). */
  viewerSeat: number;
  flySeat: number | null;
  tones: ReadonlyMap<number, SeatTone>;
}

export function useFlyWorld(options: FlyWorldOptions): void {
  const { active, target, free, reducedMotion, canvasRef, worldRef, tetherRef } = options;
  const pose = useRef<FlyWorld>(WORLD_ID);
  const tween = useRef(0);
  const live = useRef(options);
  live.current = options;

  const apply = (w: FlyWorld) => {
    const world = worldRef.current;
    if (world) world.style.transform = worldTransform(w);
    const ring = canvasRef.current?.querySelector<HTMLElement>("[data-turn-ring]");
    ring?.style.setProperty("--ry", `${(-w.yawDeg).toFixed(1)}deg`);
  };

  useEffect(() => {
    const to = active ? target : WORLD_ID;
    const from = pose.current;
    const goal: FlyWorld = { ...to, yawDeg: from.yawDeg + normalizeAngle(to.yawDeg - from.yawDeg) };
    const same = (Object.keys(goal) as Array<keyof FlyWorld>).every((key) => Math.abs(goal[key] - from[key]) < 0.01);
    const instant = same || reducedMotion || (active && free);
    const id = ++tween.current;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      if (id !== tween.current) return;
      const p = instant ? 1 : Math.min(1, (now - t0) / DURATION_MS);
      const e = easeOut4(p);
      const next = { ...from };
      for (const key of Object.keys(goal) as Array<keyof FlyWorld>) next[key] = from[key] + (goal[key] - from[key]) * e;
      if (p >= 1) next.yawDeg = normalizeAngle(next.yawDeg);
      pose.current = next;
      apply(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    step(t0);
    return () => cancelAnimationFrame(frame);
    // The pose values, not the object, decide: a new object with the same numbers must not restart the tween.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, target.yawDeg, target.tiltDeg, target.zoom, target.fx, target.fy, target.oy, free, reducedMotion]);

  // Holo panels beside their seats, and the tethers, every frame while the fly-in view is on.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    let frame = 0;
    const holos = () => [...canvas.querySelectorAll<HTMLElement>("[data-holo]")];
    const place = () => {
      frame = requestAnimationFrame(place);
      const { viewerSeat, flySeat, tones } = live.current;
      const origin = canvas.getBoundingClientRect();
      const k = origin.width / 1100;
      if (!(k > 0)) return;
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: (r.left + r.width / 2 - origin.left) / k, y: (r.top + r.height / 2 - origin.top) / k, l: (r.left - origin.left) / k, t: (r.top - origin.top) / k, r: (r.right - origin.left) / k, b: (r.bottom - origin.top) / k };
      };
      const handEl = [...canvas.querySelectorAll<HTMLElement>(`[data-hand-seat="${viewerSeat}"]`)].find((el) => el.getBoundingClientRect().width > 0);
      const hand = handEl ? box(handEl) : null;
      let lines = "";
      for (const holo of holos()) {
        const seat = Number(holo.dataset.holo);
        const field = canvas.querySelector(`[data-seat-field="${seat}"]`);
        if (!field) continue;
        const c = box(field);
        const w = holo.offsetWidth;
        const h = holo.offsetHeight;
        const off = c.x < -60 || c.x > 1160 || c.y < -60 || c.y > 920 || (flySeat != null && flySeat !== seat);
        holo.dataset.offcam = off ? "true" : "false";
        // Above the projected field for an upper seat, below it for a lower one.
        const centre = { x: 550, y: 410 };
        let x = c.x - w / 2 + (c.x < centre.x - 40 ? -40 : c.x > centre.x + 40 ? 40 : 0);
        let y = c.y < centre.y ? c.t - h - 10 : c.b + 8;
        const floor = hand ? hand.t - 6 : 852;
        if (c.y >= centre.y && y + h > floor) {
          y = c.b - h;
          x = c.r + 12;
        }
        x = clamp(x, 8, 1100 - w - 8);
        y = clamp(y, 8, 860 - h - 8);
        if (hand && x < hand.r + 6 && x + w > hand.l - 6 && y + h > hand.t - 4) {
          x = c.x >= 550 ? Math.min(1100 - w - 8, hand.r + 10) : Math.max(8, hand.l - w - 10);
        }
        holo.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
        if (!off) {
          const tx = clamp(c.x, x + 10, x + w - 10);
          const ty = c.y < y ? y : c.y > y + h ? y + h : c.y;
          if (Math.hypot(tx - c.x, ty - c.y) > 10) {
            const rgb = hexToRgbTriplet(SEAT_TONE_HEX[tones.get(seat) ?? "ice"].main);
            lines += `<line x1="${c.x.toFixed(1)}" y1="${c.y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="rgb(${rgb} / .55)" stroke-width="1.2" stroke-dasharray="2 3"/><circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="rgb(${rgb})"/>`;
          }
        }
      }
      if (tetherRef.current) tetherRef.current.innerHTML = lines;
    };
    place();
    return () => {
      cancelAnimationFrame(frame);
      for (const holo of holos()) {
        holo.style.transform = "";
        delete holo.dataset.offcam;
      }
      if (tetherRef.current) tetherRef.current.innerHTML = "";
    };
  }, [active, canvasRef, tetherRef]);
}
