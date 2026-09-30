"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, isDefense, zoneKey } from "./constants";
import { battleOutcome, type BattleOutcome } from "./battle-outcome";
import { attackStyleFor, battleKind, battleTiming, type AttackCardLike, type AttackStyleId, type BattleKind, type BattleTiming } from "./attack-styles";
import { runAttackFx, type AttackFxPlan, type FxCut, type FxLpHit, type FxSide } from "./attack-fx";
import { holdPromptReveal } from "./prompt-reveal";
import { collectFreshEvents, maxEventId } from "./event-queue";
import { duelFontClasses } from "./fonts";
import { armLpHold } from "./life-points";
import styles from "./battle-fx.module.css";

/**
 * Battle effects, drawn in one fixed overlay above the board (pointer-events: none).
 *
 *  - Attack playback: engine "attack" events, for both players and the bot. The attacker's
 *    monster plays its own attack style (attack-styles.ts picks it from the card's passcode,
 *    name and race; attack-fx.ts draws it): a slash, claw rakes, a beam, an arcane orb, a
 *    lightning bolt, a fireball or a heavy smash, tinted by its attribute. The card(s) the
 *    battle destroyed break up in the style that killed them: the target in the attacker's style,
 *    or, when a weaker attacker loses, the attacker in the DEFENDER's style after its counter
 *    strike; both on equal ATK, neither when a defender holds (see battle-outcome.ts).
 *  - Aim layer: the arrow you steer while choosing an attack (preview, aim, locked).
 *
 * Which cards fight: `seats` (the engine view) is indexed by zone before each snapshot lands, so a
 * card that dies still has its identity. Without `seats` the passcode is read from the art's image
 * URL; an unknown card gets the default "impact" style in a light tint.
 *
 * Nothing here blocks input or answers. Anchors are found with
 * `[data-zones~="<zoneKey>"]` and `[data-lp-seat="<seat>"]`.
 */

/** Reference timings (ms) for an average attack. Each play's real timing comes from its styles (attack-styles.ts). */
export const BATTLE_TOTAL_MS = 1250;
/** Reduced motion: flashes and fades only. */
export const BATTLE_REDUCED_MS = 800;
/** Reference impact time. Each style lands between 440 and 560 ms; the LP roll waits for the real one. */
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
  /** The engine view's seats: names the fighting cards so each plays its own attack style. Optional. */
  seats?: readonly DuelSeatView[];
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

/* ---------- which cards fight ---------- */

/** What the style resolver needs, plus the position (a Defense Position target shows a shield when it holds). */
type BattleCard = AttackCardLike & { position?: number };
type CardIndex = Map<string, BattleCard>;

/** The monsters of the engine view, by zone key. */
function indexSeats(seats: readonly DuelSeatView[] | undefined): CardIndex {
  const index: CardIndex = new Map();
  for (const seat of seats ?? []) {
    for (const card of seat.monsters) {
      if (!card) continue;
      index.set(zoneKey(card.controller, card.location, card.sequence), {
        code: card.code, name: card.name, race: card.race, attribute: card.attribute, position: card.position,
      });
    }
    const master = seat.deckMaster;
    if (master?.inZone) {
      index.set(zoneKey(seat.seat, LOCATION_DMZONE, 0), {
        code: master.card.code, name: master.card.name, race: master.card.race, attribute: master.card.attribute,
      });
    }
  }
  return index;
}

/** The passcode in a card image URL (`/api/cards/<code>/image`): the fallback when no view is given. */
function codeFromArt(art: Element | null): number | undefined {
  const src = art?.querySelector("img")?.getAttribute("src") ?? "";
  const match = /\/cards\/(\d+)\/image/.exec(src);
  return match ? Number(match[1]) : undefined;
}

function readCard(key: string, node: HTMLElement, prev: CardIndex, now: CardIndex): BattleCard {
  const known = prev.get(key) ?? now.get(key) ?? {};
  const art = node.querySelector("[data-card-art]");
  return { ...known, code: known.code ?? codeFromArt(art) };
}

/* ---------- capture (before the new snapshot reaches the DOM) ---------- */

type CutSource = FxCut;
type AttackCapture = {
  from: Box;
  to: Box;
  direct: boolean;
  /** The attacker's art, captured before the board updates (it may be the one that dies). */
  attacker: CutSource | null;
  /** The target's art, captured the same way. */
  target: CutSource | null;
  fromEl: Element | null;
  toEl: Element | null;
  attackerCard: BattleCard;
  targetCard: BattleCard | null;
  targetInDefense: boolean;
  /** LP tally boxes by seat, for the damage flash. */
  lp: Record<number, Box | undefined>;
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
function captureAttack(event: DuelEvent, prev: CardIndex, now: CardIndex): AttackCapture | null {
  const zone = event.zone;
  if (!zone) return null;
  const fromKey = keyOfZone(zone);
  const fromNode = zoneNode(fromKey);
  const from = fromNode ? zoneBox(fromKey) : null;
  if (!fromNode || !from) return null;
  const lp: Record<number, Box | undefined> = { 0: lpBox(0) ?? undefined, 1: lpBox(1) ?? undefined };
  const base = {
    from,
    attacker: cutSourceOf(fromNode),
    fromEl: fromNode.querySelector("[data-card-art]"),
    attackerCard: readCard(fromKey, fromNode, prev, now),
    lp,
  };
  if (event.target) {
    const targetKey = keyOfZone(event.target);
    const node = zoneNode(targetKey);
    if (!node) return null;
    const target = cutSourceOf(node);
    const to = target?.box ?? boxOf(node);
    if (to.width <= 0 || to.height <= 0) return null;
    const targetCard = readCard(targetKey, node, prev, now);
    const targetInDefense = node.getAttribute("data-defense") === "true" || isDefense(prev.get(targetKey)?.position ?? now.get(targetKey)?.position);
    return { ...base, to, direct: false, target, toEl: node.querySelector("[data-card-art]"), targetCard, targetInDefense };
  }
  const to = lpBox(1 - zone.controller);
  if (!to) return null;
  return { ...base, to, direct: true, target: null, toEl: null, targetCard: null, targetInDefense: false };
}

/* ---------- playback model ---------- */

type Play = {
  seq: number;
  reduced: boolean;
  fx: AttackFxPlan;
  style: AttackStyleId;
  /** The defender's style when it strikes back (the attacker lost), else null. */
  counterStyle: AttackStyleId | null;
  kind: BattleKind;
  totalMs: number;
};

type Resolved = {
  kind: BattleKind;
  outcome: BattleOutcome;
  attackerStyle: ReturnType<typeof attackStyleFor>;
  defenderStyle: ReturnType<typeof attackStyleFor> | null;
  timing: BattleTiming;
};

/** Reduced motion: one flash on each side, the loser fades; no travel. */
function reducedTiming(kind: BattleKind): BattleTiming {
  return { impactMs: 260, attackerDamageMs: kind === "lose" ? 520 : 400, totalMs: BATTLE_REDUCED_MS };
}

/** Pure: who fights, how it ends, and when things land. Called at capture (LP holds) and at play time. */
function resolveBattle(capture: AttackCapture, events: readonly DuelEvent[], attack: DuelEvent, reduced: boolean): Resolved {
  const outcome = battleOutcome(events, attack);
  const kind = battleKind(capture.direct, outcome);
  const attackerStyle = attackStyleFor(capture.attackerCard);
  const defenderStyle = capture.direct ? null : attackStyleFor(capture.targetCard);
  const timing = reduced ? reducedTiming(kind) : battleTiming(kind, attackerStyle.style, defenderStyle?.style ?? null);
  return { kind, outcome, attackerStyle, defenderStyle, timing };
}

/** Damage that follows an attack in the same snapshot (battle or effect). */
function battleDamageEvents(events: readonly DuelEvent[], attack: DuelEvent): DuelEvent[] {
  return events.filter((event) => {
    if (event.kind !== "damage" || event.id <= attack.id || event.seat == null) return false;
    return event.cause == null || event.cause === "battle" || event.cause === "effect";
  });
}

/** When the LP roll for `event` starts: the counter's impact for damage to the attacker, else the strike's impact. */
function damageDelay(event: DuelEvent, attack: DuelEvent, direct: boolean, timing: BattleTiming): number {
  return !direct && event.seat === attack.zone?.controller ? timing.attackerDamageMs : timing.impactMs;
}

function buildPlay(seq: number, capture: AttackCapture, reduced: boolean, events: readonly DuelEvent[], attack: DuelEvent): Play | null {
  const resolved = resolveBattle(capture, events, attack, reduced);
  const { kind, timing, attackerStyle, defenderStyle } = resolved;
  const attacker: FxSide = {
    box: capture.from, el: capture.fromEl, style: attackerStyle.style, tint: attackerStyle.tint,
    caption: attackerStyle.caption, cut: capture.attacker,
  };
  const defender: FxSide | null = defenderStyle
    ? {
        box: capture.target?.box ?? capture.to, el: capture.toEl, style: defenderStyle.style, tint: defenderStyle.tint,
        caption: defenderStyle.caption, cut: capture.target,
      }
    : null;
  const lpHits: FxLpHit[] = [];
  for (const event of battleDamageEvents(events, attack)) {
    const seat = event.seat as number;
    const box = capture.lp[seat];
    if (!box) continue;
    lpHits.push({ box, at: damageDelay(event, attack, capture.direct, timing), toAttacker: !capture.direct && seat === attack.zone?.controller });
  }
  const fx: AttackFxPlan = {
    reduced, kind, attacker, defender, hit: capture.to, defenderInDefense: capture.targetInDefense,
    lpHits, seed: (attack.id * 2654435761) >>> 0, timing,
  };
  return {
    seq, reduced, fx, style: attackerStyle.style,
    counterStyle: kind === "lose" && defenderStyle ? defenderStyle.style : null,
    kind, totalMs: timing.totalMs,
  };
}

/* ---------- attack playback ---------- */

function AttackPlay({ play }: { play: Play }) {
  const htmlRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Builds every node up front; each animates on its own delay (no render loop). Cleanup removes them.
  useLayoutEffect(() => {
    const html = htmlRef.current;
    const svg = svgRef.current;
    if (!html || !svg) return;
    return runAttackFx(html, svg, play.fx, {
      veil: styles.veil, frags: styles.frags, piece: styles.piece, inner: styles.inner,
      caption: styles.caption, lpFlash: styles.lpFlash,
    });
  }, [play]);

  return (
    <div
      className={styles.play}
      data-style={play.style}
      data-counter-style={play.counterStyle ?? undefined}
      data-kind={play.kind}
      data-reduced={play.reduced ? "true" : "false"}
      style={{ "--total": `${play.totalMs}ms` } as CSSProperties}
    >
      <div ref={htmlRef} className={styles.htmlLayer} />
      <svg ref={svgRef} className={styles.svg} aria-hidden />
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

/** Damage that follows an attack in the same snapshot rolls when the strike that dealt it lands. */
function armBattleDamage(events: readonly DuelEvent[], attack: DuelEvent, capture: AttackCapture | null): void {
  const timing = capture ? resolveBattle(capture, events, attack, false).timing : null;
  for (const event of battleDamageEvents(events, attack)) {
    const ms = timing ? damageDelay(event, attack, capture?.direct ?? false, timing) : BATTLE_IMPACT_MS;
    armLpHold(event.seat as number, ms, `damage-${event.id}`);
  }
}

export function BattleFx({ events, reducedMotion, active = true, aim = null, seats }: BattleFxProps) {
  const [mounted, setMounted] = useState(false);
  const [play, setPlay] = useState<Play | null>(null);
  const initialRef = useRef<number | null>(null);
  const processedRef = useRef(0);
  const capturesRef = useRef(new Map<number, AttackCapture | null>());
  const seqRef = useRef(0);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  // The board's monsters as of the last commit, and as of this render: an attack's cards are read
  // from the older one, because the newer snapshot may already have taken the card that died.
  const prevIndexRef = useRef<CardIndex>(new Map());
  const nowIndex = indexSeats(seats);

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
      if (!capturesRef.current.has(latest.id)) capturesRef.current.set(latest.id, captureAttack(latest, prevIndexRef.current, nowIndex));
      if (!reducedMotion) armBattleDamage(events, latest, capturesRef.current.get(latest.id) ?? null);
    }
  }

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    prevIndexRef.current = nowIndex;
  });

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
    const capture = capturesRef.current.get(latest.id) ?? captureAttack(latest, prevIndexRef.current, indexSeats(seats));
    capturesRef.current.delete(latest.id);
    // The destroy events after the attack (in this snapshot) say which card(s) the battle took.
    const next = capture ? buildPlay(++seqRef.current, capture, reducedRef.current, events, latest) : null;
    if (next) {
      holdPromptReveal(next.totalMs);
      setPlay(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seats` only names cards for a late capture
  }, [events, active]);

  useEffect(() => {
    if (!play) return;
    const timer = window.setTimeout(() => setPlay((current) => (current?.seq === play.seq ? null : current)), play.totalMs + 60);
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
