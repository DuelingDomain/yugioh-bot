"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { zoneKey } from "./constants";
import { battleOutcome, type BattleOutcome } from "./battle-outcome";
import { holdPromptReveal } from "./prompt-reveal";
import { collectFreshEvents, maxEventId } from "./event-queue";
import { duelFontClasses } from "./fonts";
import { armLpHold } from "./life-points";
import styles from "./battle-fx.module.css";

/**
 * Battle effects, drawn in one fixed overlay above the board (pointer-events: none).
 *
 *  - Attack playback: engine "attack" events, for both players and the bot. An arrow draws from
 *    the attacker's zone to the target's zone (or the defender's LP tally for a direct attack),
 *    a sword slash sweeps across the target, and the card(s) the battle destroyed are visibly cut
 *    in two: the target, the attacker (a weaker monster attacking into a stronger one), both on
 *    equal ATK, or neither when a defender holds (see battle-outcome.ts). Then it all fades.
 *  - Aim layer: the arrow you steer while choosing an attack (preview, aim, locked).
 *
 * Nothing here blocks input or answers. Anchors are found with
 * `[data-zones~="<zoneKey>"]` and `[data-lp-seat="<seat>"]`.
 */

/** Whole attack sequence, ms. */
export const BATTLE_TOTAL_MS = 1250;
/** Reduced motion: a static arrow that flashes in and fades. */
export const BATTLE_REDUCED_MS = 800;
/** When the slash lands, ms after the attack starts. The LP roll for its damage starts here. */
export const BATTLE_IMPACT_MS = 490;

export type BattleAim = {
  /** preview: dim dashed hint on an action-menu option; aim: hovering a target; locked: target chosen, awaiting confirm. */
  mode: "preview" | "aim" | "locked";
  /** Zone key of the attacker (`controller:location:sequence`). */
  from: string | null;
  /** Where the arrow points: zone keys of card targets and/or a seat whose LP tally is the target. */
  to: { zones?: readonly string[]; lpSeat?: number | null };
};

export type BattleFxProps = {
  events: readonly DuelEvent[];
  reducedMotion: boolean;
  /** false pauses playback (reconnecting): events that arrive meanwhile are treated as seen. Default true. */
  active?: boolean;
  aim?: BattleAim | null;
};

/* ---------- geometry ---------- */

type Pt = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function centerOf(box: Box): Pt {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function zoneNode(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-zones~="${key}"]`);
}

function zoneBox(key: string): Box | null {
  const node = zoneNode(key);
  if (!node) return null;
  const box = boxOf(node.querySelector("[data-card-art]") ?? node);
  return box.width > 0 && box.height > 0 ? box : null;
}

function lpBox(seat: number): Box | null {
  const node = document.querySelector<HTMLElement>(`[data-lp-seat="${seat}"]`);
  if (!node) return null;
  const box = boxOf(node.querySelector("strong") ?? node);
  return box.width > 0 && box.height > 0 ? box : null;
}

/** The point where a ray from the box centre toward `toward` leaves the box, pushed out by `gap`. */
function edgePoint(box: Box, toward: Pt, gap: number): Pt {
  const c = centerOf(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return c;
  const ux = dx / len;
  const uy = dy / len;
  const tx = ux === 0 ? Infinity : box.width / 2 / Math.abs(ux);
  const ty = uy === 0 ? Infinity : box.height / 2 / Math.abs(uy);
  const t = Math.min(tx, ty);
  return { x: c.x + ux * (t + gap), y: c.y + uy * (t + gap) };
}

type Arrow = { d: string; head: string; start: Pt; tip: Pt };

function arrowBetween(from: Box, to: Box): Arrow | null {
  const s = edgePoint(from, centerOf(to), 4);
  const e = edgePoint(to, centerOf(from), 8);
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.hypot(dx, dy);
  if (len < 12) return null;
  const bow = Math.min(90, len * 0.14);
  const mx = (s.x + e.x) / 2 + (-dy / len) * bow;
  const my = (s.y + e.y) / 2 + (dx / len) * bow;
  const angle = Math.atan2(e.y - my, e.x - mx);
  const barb = (offset: number): string => {
    const a = angle + Math.PI + offset;
    return `${(e.x + Math.cos(a) * 13).toFixed(1)},${(e.y + Math.sin(a) * 13).toFixed(1)}`;
  };
  return {
    d: `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`,
    head: `M${barb(-0.52)} L${e.x.toFixed(1)},${e.y.toFixed(1)} L${barb(0.52)}`,
    start: s,
    tip: e,
  };
}

type Slash = { x1: number; y1: number; x2: number; y2: number };

/** A diagonal across the box, running a little past both corners. */
function slashAcross(box: Box, mirror: boolean): Slash {
  const ext = 0.16;
  const p = mirror ? { x: box.left, y: box.top } : { x: box.left + box.width, y: box.top };
  const q = mirror ? { x: box.left + box.width, y: box.top + box.height } : { x: box.left, y: box.top + box.height };
  const vx = q.x - p.x;
  const vy = q.y - p.y;
  return { x1: p.x - vx * ext, y1: p.y - vy * ext, x2: q.x + vx * ext, y2: q.y + vy * ext };
}

/** A steeper, LP-sized slash through the counter, so it reads as a diagonal cut, not a scratch. */
function slashThroughCounter(box: Box): Slash {
  const c = centerOf(box);
  const h = Math.max(box.height * 0.9, 28);
  return { x1: c.x + h * 0.85, y1: c.y - h, x2: c.x - h * 0.85, y2: c.y + h };
}

/* ---------- capture (before the new snapshot reaches the DOM) ---------- */

type CutSource = { box: Box; innerW: number; innerH: number; html: string };
type AttackCapture = {
  from: Box;
  to: Box;
  direct: boolean;
  /** The attacker's art, captured before the board updates (it may be the one that dies). */
  attacker: CutSource | null;
  /** The target's art, captured the same way. */
  target: CutSource | null;
};

function keyOfZone(zone: { controller: number; location: number; sequence: number }): string {
  return zoneKey(zone.controller, zone.location, zone.sequence);
}

function cutSourceOf(node: HTMLElement): CutSource | null {
  const art = node.querySelector<HTMLElement>("[data-card-art]");
  if (!art) return null;
  const box = boxOf(art);
  if (box.width <= 0 || box.height <= 0) return null;
  return { box, innerW: art.offsetWidth || box.width, innerH: art.offsetHeight || box.height, html: art.outerHTML };
}

/**
 * Reads the board for one attack event. Called while React renders the snapshot that carries the
 * event, which is BEFORE the DOM shows the battle result, so a card that dies still has its art.
 * Both the attacker's and the target's art are kept: which one is cut is decided at play time.
 */
function captureAttack(event: DuelEvent): AttackCapture | null {
  const zone = event.zone;
  if (!zone) return null;
  const fromNode = zoneNode(keyOfZone(zone));
  const from = fromNode ? zoneBox(keyOfZone(zone)) : null;
  if (!fromNode || !from) return null;
  const attacker = cutSourceOf(fromNode);
  if (event.target) {
    const node = zoneNode(keyOfZone(event.target));
    if (!node) return null;
    const target = cutSourceOf(node);
    const to = target?.box ?? boxOf(node);
    if (to.width <= 0 || to.height <= 0) return null;
    return { from, to, direct: false, attacker, target };
  }
  const to = lpBox(1 - zone.controller);
  if (!to) return null;
  return { from, to, direct: true, attacker, target: null };
}

/* ---------- playback model ---------- */

type Half = { clip: string; nx: number; ny: number; rot: number };
type Cut = CutSource & { role: "attacker" | "target"; halves: [Half, Half]; sep: number };

type Play = {
  seq: number;
  reduced: boolean;
  arrow: Arrow;
  hit: Box;
  center: Pt;
  slash: Slash;
  direct: boolean;
  /** The card(s) the battle destroyed, each cut in two along the slash's diagonal. */
  cuts: Cut[];
};

function cutOf(source: CutSource, role: Cut["role"], mirror: boolean): Cut {
  const { width: w, height: h } = source.box;
  const len = Math.hypot(w, h) || 1;
  // Two halves of the card on either side of the diagonal the slash follows.
  const halves: [Half, Half] = mirror
    ? [
        // The first half runs 1px past the diagonal so the pair leaves no hairline seam at rest.
        { clip: "polygon(0 0, 100% 0, 100% calc(100% + 1px), 0 1px)", nx: h / len, ny: -w / len, rot: 1.6 },
        { clip: "polygon(0 0, 100% 100%, 0 100%)", nx: -h / len, ny: w / len, rot: -1.6 },
      ]
    : [
        { clip: "polygon(0 0, 100% 0, 100% 1px, 0 calc(100% + 1px))", nx: -h / len, ny: -w / len, rot: -1.6 },
        { clip: "polygon(100% 0, 100% 100%, 0 100%)", nx: h / len, ny: w / len, rot: 1.6 },
      ];
  return { ...source, role, halves, sep: Math.max(3, Math.min(7, w * 0.07)) };
}

function buildPlay(seq: number, capture: AttackCapture, reduced: boolean, outcome: BattleOutcome): Play | null {
  const arrow = arrowBetween(capture.from, capture.to);
  if (!arrow) return null;
  const hit = capture.to;
  const center = centerOf(hit);
  const dx = center.x - centerOf(capture.from).x;
  const mirror = dx < 0;
  const slash = capture.direct ? slashThroughCounter(hit) : slashAcross(hit, mirror);
  const cuts: Cut[] = [];
  if (outcome.target && capture.target) cuts.push(cutOf(capture.target, "target", mirror));
  if (outcome.attacker && capture.attacker) cuts.push(cutOf(capture.attacker, "attacker", mirror));
  return { seq, reduced, arrow, hit, center, slash, direct: capture.direct, cuts };
}

const SPARK_ANGLES = [-70, -28, 14, 52, 98, 146, 200, 250];

/* ---------- attack playback ---------- */

function AttackPlay({ play }: { play: Play }) {
  const { arrow, hit, center, slash, cuts } = play;
  const total = play.reduced ? BATTLE_REDUCED_MS : BATTLE_TOTAL_MS;
  const origin = (p: Pt): CSSProperties => ({ transformOrigin: `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px` });
  const ringPad = play.direct ? 6 : 5;
  return (
    <div className={styles.play} data-reduced={play.reduced ? "true" : "false"} style={{ "--total": `${total}ms` } as CSSProperties}>
      {cuts.map((cut) => (
        <div
          key={cut.role}
          className={styles.cut}
          data-role={cut.role}
          style={{
            left: cut.box.left,
            top: cut.box.top,
            width: cut.box.width,
            height: cut.box.height,
            "--iw": `${cut.innerW}px`,
            "--ih": `${cut.innerH}px`,
            "--sep": `${cut.sep}px`,
          } as CSSProperties}
        >
          {(play.reduced ? cut.halves.slice(0, 1) : cut.halves).map((half, index) => (
            <div
              key={index}
              className={`${styles.half} ${index === 0 ? styles.halfA : styles.halfB}`}
              style={{
                clipPath: play.reduced ? "none" : half.clip,
                "--nx": half.nx.toFixed(3),
                "--ny": half.ny.toFixed(3),
                "--rot": `${half.rot}deg`,
              } as CSSProperties}
            >
              {/* A copy of the card's own markup, captured before the board updated. */}
              <div className={styles.inner} dangerouslySetInnerHTML={{ __html: cut.html }} />
            </div>
          ))}
        </div>
      ))}
      <svg className={styles.svg} aria-hidden>
        <rect
          className={styles.hitRing}
          x={hit.left - ringPad}
          y={hit.top - ringPad}
          width={hit.width + ringPad * 2}
          height={hit.height + ringPad * 2}
          rx={play.direct ? 8 : 9}
        />
        <g className={styles.arrow}>
          <path className={styles.arrowShadow} d={arrow.d} pathLength={1} />
          <path className={styles.arrowLine} d={arrow.d} pathLength={1} />
          <path className={styles.arrowEnergy} d={arrow.d} pathLength={1} />
          <circle className={styles.origin} cx={arrow.start.x} cy={arrow.start.y} r={3.6} style={origin(arrow.start)} />
          <path className={styles.arrowHead} d={arrow.head} style={origin(arrow.tip)} />
        </g>
        <g className={styles.slash}>
          <path className={styles.slashGlow} d={`M${slash.x1},${slash.y1} L${slash.x2},${slash.y2}`} pathLength={1} />
          <path className={styles.slashLine} d={`M${slash.x1},${slash.y1} L${slash.x2},${slash.y2}`} pathLength={1} />
        </g>
        <circle
          className={styles.flash}
          cx={center.x}
          cy={center.y}
          r={Math.max(18, Math.min(hit.width, hit.height) * (play.direct ? 0.9 : 0.55))}
          style={origin(center)}
        />
      </svg>
      {play.direct ? (
        <div
          className={styles.lpFlash}
          style={{ left: hit.left - 8, top: hit.top - 4, width: hit.width + 16, height: hit.height + 8 }}
        />
      ) : null}
      {SPARK_ANGLES.map((angle, index) => (
        <i
          key={angle}
          className={styles.spark}
          style={{ left: center.x, top: center.y, "--a": `${angle}deg`, "--d": `${26 + (index % 3) * 9}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}

/* ---------- aim layer ---------- */

type AimGeom = { mode: BattleAim["mode"]; from: Box; arrows: Arrow[]; rings: Box[] };

function measureAim(aim: BattleAim | null | undefined): AimGeom | null {
  if (!aim?.from) return null;
  const from = zoneBox(aim.from);
  if (!from) return null;
  const targets: Box[] = [];
  if (aim.to.lpSeat != null) {
    const box = lpBox(aim.to.lpSeat);
    if (box) targets.push(box);
  }
  for (const key of aim.to.zones ?? []) {
    const box = zoneBox(key);
    if (box) targets.push(box);
  }
  const arrows = targets.map((target) => arrowBetween(from, target)).filter((arrow): arrow is Arrow => arrow != null);
  if (arrows.length === 0) return null;
  return { mode: aim.mode, from, arrows, rings: aim.mode === "preview" ? [] : targets };
}

function aimSignature(aim: BattleAim | null | undefined): string {
  if (!aim?.from) return "";
  return `${aim.mode}|${aim.from}|${(aim.to.zones ?? []).join(",")}|${aim.to.lpSeat ?? ""}`;
}

function AimLayer({ aim, reduced }: { aim: BattleAim; reduced: boolean }) {
  const [geom, setGeom] = useState<AimGeom | null>(null);
  const aimRef = useRef(aim);
  aimRef.current = aim;
  const signature = aimSignature(aim);

  useLayoutEffect(() => {
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      setGeom(measureAim(aimRef.current));
    };
    const schedule = () => {
      if (frame == null) frame = requestAnimationFrame(measure);
    };
    setGeom(measureAim(aimRef.current));
    // The prompt dock or a scrollbar can shift the board a frame later.
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const field = document.querySelector("[data-duel-field]");
    const observer = typeof ResizeObserver === "function" && field ? new ResizeObserver(schedule) : null;
    if (field) observer?.observe(field);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      observer?.disconnect();
    };
  }, [signature]);

  if (!geom) return null;
  const ring = (box: Box, index: number, pad: number) => (
    <rect
      key={`ring-${index}`}
      className={styles.aimRing}
      x={box.left - pad}
      y={box.top - pad}
      width={box.width + pad * 2}
      height={box.height + pad * 2}
      rx={9}
    />
  );
  return (
    <svg className={styles.svg} aria-hidden data-aim={geom.mode} data-reduced={reduced ? "true" : "false"}>
      <g key={signature} className={styles.aim} data-mode={geom.mode}>
        {geom.mode !== "preview" ? ring(geom.from, -1, 4) : null}
        {geom.rings.map((box, index) => ring(box, index, 5))}
        {geom.arrows.map((arrow, index) => (
          <g key={index}>
            <path className={styles.aimShadow} d={arrow.d} />
            <path className={styles.aimLine} d={arrow.d} />
            <path className={styles.aimHead} d={arrow.head} />
          </g>
        ))}
        <circle className={styles.aimOrigin} cx={geom.arrows[0].start.x} cy={geom.arrows[0].start.y} r={3.4} />
      </g>
    </svg>
  );
}

/* ---------- component ---------- */

/** Damage that follows an attack in the same snapshot (battle or effect) rolls when the slash lands. */
function armBattleDamage(events: readonly DuelEvent[], attackId: number): void {
  for (const event of events) {
    if (event.kind !== "damage" || event.id <= attackId || event.seat == null) continue;
    if (event.cause != null && event.cause !== "battle" && event.cause !== "effect") continue;
    armLpHold(event.seat, BATTLE_IMPACT_MS, `damage-${event.id}`);
  }
}

export function BattleFx({ events, reducedMotion, active = true, aim = null }: BattleFxProps) {
  const [mounted, setMounted] = useState(false);
  const [play, setPlay] = useState<Play | null>(null);
  const initialRef = useRef<number | null>(null);
  const processedRef = useRef(0);
  const capturesRef = useRef(new Map<number, AttackCapture | null>());
  const seqRef = useRef(0);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  // Events already in the first snapshot never play: a reload must not replay the last fight.
  if (initialRef.current == null) initialRef.current = maxEventId(events) ?? 0;

  // Render phase on purpose. The DOM still shows the board BEFORE this snapshot, so the geometry
  // and the art of a card that is about to die can be read, and the LP hold is armed before the
  // LP counters (rendered in this same commit) start their roll. Both writes are keyed and idempotent.
  if (active) {
    const after = Math.max(initialRef.current, processedRef.current);
    let latest: DuelEvent | null = null;
    for (const event of events) {
      if (event.id > after && event.kind === "attack" && event.zone && (!latest || event.id > latest.id)) latest = event;
    }
    if (latest && typeof document !== "undefined") {
      if (!capturesRef.current.has(latest.id)) capturesRef.current.set(latest.id, captureAttack(latest));
      if (!reducedMotion) armBattleDamage(events, latest.id);
    }
  }

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const after = Math.max(initialRef.current ?? 0, processedRef.current);
    const { nextCursor, fresh } = collectFreshEvents(events, after);
    processedRef.current = nextCursor;
    for (const id of Array.from(capturesRef.current.keys())) {
      if (id <= nextCursor && !fresh.some((event) => event.id === id)) capturesRef.current.delete(id);
    }
    if (!active || fresh.length === 0) return;
    // A burst (reload, poll catch-up) plays only the newest attack, never the old ones.
    let latest: DuelEvent | null = null;
    for (const event of fresh) if (event.kind === "attack" && event.zone) latest = event;
    if (!latest) return;
    const capture = capturesRef.current.get(latest.id) ?? captureAttack(latest);
    capturesRef.current.delete(latest.id);
    // The destroy events after the attack (in this snapshot) say which card(s) the battle took.
    const next = capture ? buildPlay(++seqRef.current, capture, reducedRef.current, battleOutcome(events, latest)) : null;
    if (next) {
      holdPromptReveal(next.reduced ? BATTLE_REDUCED_MS : BATTLE_TOTAL_MS);
      setPlay(next);
    }
  }, [events, active]);

  useEffect(() => {
    if (!play) return;
    const ms = (play.reduced ? BATTLE_REDUCED_MS : BATTLE_TOTAL_MS) + 60;
    const timer = window.setTimeout(() => setPlay((current) => (current?.seq === play.seq ? null : current)), ms);
    return () => window.clearTimeout(timer);
  }, [play]);

  if (!mounted) return null;
  return createPortal(
    <div className={`${styles.layer} ${duelFontClasses}`} aria-hidden>
      {aim ? <AimLayer aim={aim} reduced={reducedMotion} /> : null}
      {play ? <AttackPlay key={play.seq} play={play} /> : null}
    </div>,
    document.body,
  );
}
