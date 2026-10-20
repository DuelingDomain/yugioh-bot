"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { duelFxClock } from "../fx-clock";
import { crackSeed, useFieldCracksScope } from "./context";
import { dropChunk, removeDebrisLayer } from "./debris";
import {
  genField,
  layoutKey,
  maskImageOf,
  REF_W,
  type CrackChunk,
  type CrackField,
  type EdgeSides,
  type FieldLayout,
  type Rect,
} from "./gen";
import { setFaceMask } from "./mask";
import { measureFace, ZONE_SELECTOR, type Measured } from "./measure";
import { crackStage, nextStage, SPREAD_MS, type CrackStage, type RegainMode } from "./stage";
import styles from "./field-cracks.module.css";

/* The cracks of one field (or one half of a shared mat). Put it as the FIRST child of the mat element: it measures that
   element's zones, draws hairlines under the cards, and masks the mat itself where a chunk of the edge has broken off.
   Nothing here runs per frame: the SVG is static and the spread, the fall and the dust are Web Animations. */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Which part of the mat this layer owns. A 1v1 mat holds two fields: the top and the bottom half. */
export type CrackPart = "all" | "top" | "bottom";

const SIDES: Record<CrackPart, EdgeSides> = {
  all: [true, true, true, true],
  top: [true, true, false, true],
  bottom: [false, true, true, true],
};

/** Pause between the stages of a jump (a hit that skips a stage) and the start of the next one. */
const STAGE_GAP_MS = 380;

/* The highest stage a field showed in this page, per duel and field: a remount (reconnect, view switch) must not play the
   cracks again, and "keep cracks" holds even when the LP went back up while the field was not mounted. */
const highWater = new Map<string, CrackStage>();
const HIGH_WATER_MAX = 200;
/* The same, kept for the tab (sessionStorage): a reload after the LP went back up still shows the cracks. */
const STORE_PREFIX = "field-cracks:";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function recalled(key: string | undefined): CrackStage {
  if (!key) return 0;
  const known = highWater.get(key);
  if (known != null) return known;
  const raw = Number(storage()?.getItem(STORE_PREFIX + key));
  const stage = (raw >= 1 && raw <= 4 ? Math.floor(raw) : 0) as CrackStage;
  if (stage) highWater.set(key, stage);
  return stage;
}

function remember(key: string | undefined, stage: CrackStage) {
  if (!key) return;
  if (recalled(key) >= stage) return;
  highWater.delete(key);
  highWater.set(key, stage);
  if (highWater.size > HIGH_WATER_MAX) highWater.delete(highWater.keys().next().value as string);
  try {
    storage()?.setItem(STORE_PREFIX + key, String(stage));
  } catch {
    // A full or blocked store only costs the reload memory.
  }
}

/** Forget what the page remembers (tests). */
export function resetCrackMemory() {
  highWater.clear();
  fieldCache.clear();
  const store = storage();
  if (!store) return;
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const name = store.key(i);
    if (name?.startsWith(STORE_PREFIX)) store.removeItem(name);
  }
}

const fieldCache = new Map<string, CrackField>();
function fieldFor(seed: number, layout: FieldLayout, sides: EdgeSides): CrackField {
  const key = `${seed}|${sides.map(Number).join("")}|${layout.w > 0 ? layoutKey(layout) : ""}`;
  let field = fieldCache.get(key);
  if (!field) {
    field = genField(seed, layout, sides);
    fieldCache.set(key, field);
    if (fieldCache.size > 80) fieldCache.delete(fieldCache.keys().next().value as string);
  }
  return field;
}

interface Geo {
  field: CrackField;
  /** Chunks per stage, in the order they break. */
  chunks: readonly [readonly CrackChunk[], readonly CrackChunk[], readonly CrackChunk[], readonly CrackChunk[]];
  /** The field's box on the mat, in layout px. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Layout px per generator unit. */
  kx: number;
  ky: number;
  /** Screen px per layout px (rounded), and the angle of the seat the mat belongs to. */
  scale: number;
  angle: number;
  sig: string;
}

function deriveGeo(seed: number, part: CrackPart, m: Measured, angle: number): Geo {
  const top = part === "bottom" ? Math.max(0, Math.min(m.h - 20, m.splitY ?? m.h / 2)) : 0;
  const bottom = part === "top" ? Math.max(20, Math.min(m.h, m.splitY ?? m.h / 2)) : m.h;
  const rh = bottom - top;
  const zones: Rect[] = [];
  for (const z of m.zones) {
    if (z[3] <= top || z[1] >= bottom) continue;
    zones.push([z[0], Math.max(z[1], top) - top, z[2], Math.min(z[3], bottom) - top]);
  }
  const layout: FieldLayout = { w: m.w, h: rh, zones };
  const field = fieldFor(seed, layout, SIDES[part]);
  const byStage = (s: number) => field.chunks.filter((c) => c.stage === s).sort((a, b) => a.t - b.t);
  const scale = Math.round(m.scale * 20) / 20;
  const kx = m.w / field.cw;
  const ky = rh / field.ch;
  return {
    field,
    chunks: [byStage(1), byStage(2), byStage(3), byStage(4)],
    ox: 0,
    oy: top,
    w: m.w,
    h: rh,
    kx,
    ky,
    scale,
    angle,
    sig: `${seed}|${part}|${layoutKey(layout)}|${top}|${m.w}|${m.h}|${scale}|${angle}`,
  };
}

type Broken = readonly [number, number, number, number];
const brokenFor = (stage: CrackStage): Broken => [stage >= 1 ? Infinity : 0, stage >= 2 ? Infinity : 0, stage >= 3 ? Infinity : 0, stage >= 4 ? Infinity : 0];

export function prefersReducedMotion(from: Element | null): boolean {
  if (from?.closest('[data-reduced-motion="true"]')) return true;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface CrackLayerProps {
  /** Same seed and same layout give the same cracks. */
  seed: number;
  /** The stage the LP says (see crackStage). */
  stage: CrackStage;
  regainMode?: RegainMode;
  /** Replays show the stage for the seek position and never animate. */
  replay?: boolean;
  /** Where the page remembers the stage this field reached; leave out for no memory. */
  memoKey?: string;
  part?: CrackPart;
  /** False for a mat that paints nothing (a field inside a pair frame): hairlines only, no crumbling edge. */
  chunks?: boolean;
  /** CSS selector of the extra boxes the cracks and chunks must stay away from (the hand strips of 1v1). */
  avoidSelector?: string;
  /** CSS selector of the element whose middle splits a shared mat into two fields. */
  splitSelector?: string;
  /** Changes when the zones of the mat change without a resize (the shared Extra Monster row appears): the mat is measured again. */
  layoutToken?: string;
}

export function CrackLayer({ seed, stage, regainMode = "keep", replay = false, memoKey, part = "all", chunks: crumble = true, avoidSelector, splitSelector, layoutToken }: CrackLayerProps) {
  const id = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const mend = replay || regainMode === "mend";
  const first = useRef<CrackStage | null>(null);
  if (first.current === null) first.current = mend ? stage : nextStage(recalled(memoKey), stage, "keep");
  const [shown, setShown] = useState<CrackStage>(first.current);
  const shownRef = useRef<CrackStage>(first.current);
  const [broken, setBroken] = useState<Broken>(() => brokenFor(first.current as CrackStage));
  const [geo, setGeo] = useState<Geo | null>(null);
  const geoRef = useRef<Geo | null>(null);
  geoRef.current = geo;
  const from = useRef<CrackStage | null>(null);
  const timers = useRef<number[]>([]);

  // A healthy replay frame draws no cracks. Geometry generation and zone measurement
  // can take seconds across a table; defer both until a seek actually needs them.
  const needsGeometry = !replay || stage > 0;

  /* ---- measure the mat (mount, resize, zoom) */
  useIsoLayoutEffect(() => {
    if (!needsGeometry) {
      setGeo(prev => prev === null ? prev : null);
      return;
    }
    const layer = layerRef.current;
    const face = layer?.parentElement;
    if (!layer || !face) return;
    const run = () => {
      const m = measureFace(face, ZONE_SELECTOR, avoidSelector ?? null, splitSelector ?? null);
      if (!m) {
        setGeo((prev) => (prev === null ? prev : null));
        return;
      }
      const angle = Number(face.closest("[data-seat-angle]")?.getAttribute("data-seat-angle") ?? 0) || 0;
      const next = deriveGeo(seed, part, m, angle);
      setGeo((prev) => (prev && prev.sig === next.sig ? prev : next));
    };
    run();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(run) : null;
    observer?.observe(face);
    window.addEventListener("resize", run);
    // A camera zoom or a pose change is a transition on an ancestor: it moves no box, but it changes the screen scale.
    const onTransitionEnd = (event: Event) => {
      if (event.target instanceof Node && event.target !== face && event.target.contains(face)) run();
    };
    document.addEventListener("transitionend", onTransitionEnd, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", run);
      document.removeEventListener("transitionend", onTransitionEnd, true);
    };
  }, [needsGeometry, seed, part, avoidSelector, splitSelector, layoutToken]);

  /* ---- the LP moved: spread the new stage (or just show it) */
  useEffect(() => {
    const target = (mend ? stage : Math.max(shownRef.current, stage)) as CrackStage;
    const prev = shownRef.current;
    if (!mend) remember(memoKey, target);
    if (target === prev) return;
    shownRef.current = target;
    const layer = layerRef.current;
    const g = geoRef.current;
    if (replay || target < prev || !g || !layer || prefersReducedMotion(layer)) {
      setShown(target);
      setBroken(brokenFor(target));
      return;
    }
    from.current = prev;
    setShown(target);
    for (let s = prev + 1; s <= (crumble ? target : 0); s += 1) {
      const list = g.chunks[s - 1];
      const delay = (s - prev - 1) * STAGE_GAP_MS;
      const span = SPREAD_MS[s as 1 | 2 | 3 | 4];
      list.forEach((chunk, index) => {
        // The shatter of 0 LP follows the connecting cracks (they take SPREAD_MS[4]); the others break as their stage spreads.
        const at = s === 4
          ? delay + SPREAD_MS[4] + 60 + index * 70
          : delay + span * (0.18 + 0.63 * (index / Math.max(1, list.length - 1)));
        const handle: number = duelFxClock.setTimeout(() => {
            const at = timers.current.indexOf(handle);
            if (at >= 0) timers.current.splice(at, 1);
            setBroken((b) => {
              const n = [...b] as unknown as [number, number, number, number];
              n[s - 1] = Math.max(n[s - 1], index + 1);
              return n;
            });
            const placed = placementOf(layerRef.current, geoRef.current);
            if (placed) dropChunk(chunk, placed);
          }, at);
        timers.current.push(handle);
      });
    }
  }, [stage, mend, replay, memoKey, crumble]);

  /* ---- play the spread of the paths that just appeared */
  useIsoLayoutEffect(() => {
    const prev = from.current;
    from.current = null;
    const layer = layerRef.current;
    const g = geoRef.current;
    if (prev == null || !layer || !g || typeof Element.prototype.animate !== "function") return;
    layer.querySelectorAll<SVGPathElement>("[data-seg]").forEach((path) => {
      const seg = g.field.segs[Number(path.dataset.seg)];
      if (!seg || seg.stage <= prev) return;
      const span = SPREAD_MS[seg.stage];
      const delay = (seg.stage - prev - 1) * STAGE_GAP_MS + seg.t0 * span;
      duelFxClock.animate(path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: Math.max(110, (seg.t1 - seg.t0) * span),
        delay,
        easing: "cubic-bezier(.3,.6,.4,1)",
        fill: "backwards",
      });
    });
  }, [shown, geo]);

  /* ---- the mat loses the chunks that have broken off */
  const visible = useMemo(() => {
    if (!geo || !crumble) return [] as CrackChunk[];
    return geo.chunks.flatMap((list, s) => list.filter((_, index) => index < broken[s]));
  }, [geo, broken, crumble]);
  useIsoLayoutEffect(() => {
    const face = layerRef.current?.parentElement;
    if (!face) return;
    setFaceMask(face, id, geo ? maskImageOf(face.clientWidth, face.clientHeight, [{ chunks: visible, ox: geo.ox, oy: geo.oy, k: geo.kx, ky: geo.ky }]) : null);
  }, [geo, visible, id]);
  useIsoLayoutEffect(() => {
    const face = layerRef.current?.parentElement;
    const own = timers.current;
    return () => {
      if (face) {
        setFaceMask(face, id, null);
        removeDebrisLayer(face);
      }
      own.forEach((t) => duelFxClock.clearTimeout(t));
    };
  }, [id]);

  /* ---- draw */
  const style = useMemo(() => {
    if (!geo) return undefined;
    const unit = Math.min(2.4, 1 / geo.scale) * (REF_W / geo.w);
    const th = (geo.angle * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    // The light stays at the screen's top left: turn it back into the mat's own axes.
    const lx = (0.55 * c + 0.65 * s) * unit;
    const ly = (-0.55 * s + 0.65 * c) * unit;
    return { ["--u" as string]: unit.toFixed(4), ["--lx" as string]: lx.toFixed(3), ["--ly" as string]: ly.toFixed(3) } as CSSProperties;
  }, [geo]);

  const drawn = geo && shown > 0 ? geo : null;
  return (
    <div ref={layerRef} className={styles.layer} data-field-cracks="" data-crack-ambient="" data-part={part} data-stage={shown} aria-hidden="true" style={style}>
      {drawn ? (
        <svg
          className={styles.svg}
          viewBox={`0 0 ${drawn.field.cw} ${drawn.field.ch}`}
          preserveAspectRatio="none"
          focusable="false"
          style={{ left: drawn.ox, top: drawn.oy, width: drawn.w, height: drawn.h }}
        >
          {(["glow", "dark", "lite"] as const).map((layer) => (
            <g key={layer} className={styles[layer]}>
              {drawn.field.segs.map((seg, index) =>
                seg.stage <= shown ? (
                  <path key={index} d={seg.d} pathLength={1} className={`${styles.seg} ${styles[seg.kind]}`} data-seg={index} />
                ) : null,
              )}
            </g>
          ))}
          {(["rimDark", "rimLite"] as const).map((layer) => (
            <g key={layer} className={styles[layer]}>
              {visible.map((chunk) => (
                <path key={`${chunk.stage}:${chunk.cx}:${chunk.cy}`} d={chunk.rim} />
              ))}
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

function placementOf(layer: HTMLElement | null, geo: Geo | null) {
  const face = layer?.parentElement;
  if (!face || !geo) return null;
  const th = (geo.angle * Math.PI) / 180;
  return {
    face,
    ox: geo.ox,
    oy: geo.oy,
    kx: geo.kx,
    ky: geo.ky,
    w: face.clientWidth,
    h: face.clientHeight,
    gravity: [Math.sin(th), Math.cos(th)] as const,
    unit: Math.min(2.4, 1 / geo.scale),
    seed: geo.field.seed,
  };
}

export interface FieldCracksProps {
  layoutToken?: string;
  /** The seat the field belongs to (part of the seed). */
  seat: number;
  chunks?: boolean;
  /** The seat's current life points (the team total in Tag). */
  lp: number | null | undefined;
  part?: CrackPart;
  avoidSelector?: string;
  splitSelector?: string;
}

/** The cracks of a seat's field, driven by its LP and the duel scope. Renders nothing without a scope. */
export function FieldCracks({ seat, lp, part = "all", chunks, avoidSelector, splitSelector, layoutToken }: FieldCracksProps) {
  const scope = useFieldCracksScope();
  if (!scope) return null;
  return (
    <CrackLayer
      // A layer that is handed another seat (the flat view follows the focus seat) starts over: it must not keep the cracks of the seat before.
      key={`${scope.duelKey}:${seat}`}
      seed={crackSeed(scope.duelKey, seat)}
      stage={crackStage(lp, scope.startLp)}
      regainMode={scope.regain}
      replay={scope.replay}
      memoKey={`${scope.duelKey}:${seat}`}
      part={part}
      chunks={chunks}
      avoidSelector={avoidSelector}
      splitSelector={splitSelector}
      layoutToken={layoutToken}
    />
  );
}
