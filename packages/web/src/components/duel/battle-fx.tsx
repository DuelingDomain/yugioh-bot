"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelEngineView, DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, cardArtUrl, isDefense, isFacedown, zoneKey } from "./constants";
import { battleOutcome, type BattleOutcome } from "./battle-outcome";
import { battleTrigger } from "./battle-trigger";
import { attackStyleFor, battleKind, battleTiming, DESTROY_TAIL_MS, hasCounterStrike, type AttackCardLike, type AttackStyleId, type BattleKind, type BattleTiming } from "./attack-styles";
import { runAttackFx, type AttackFxPlan, type FxCut, type FxLpHit, type FxSide } from "./attack-fx";
import { armBattleDestroy, attackImpactAt, clearBattleHolds, noteAttackImpact } from "./battle-hold";
import { battleSeekMs, joinBattleClock, type BattleClock } from "./battle-clock";
import { planBattle } from "./fx3d/battle-plan";
import { pickBattleRoute } from "./fx3d/routing";
import { getSharedFx3d, viewportToHost } from "./fx3d/shared";
import type { FxRect } from "./fx3d/types";
import { holdPromptReveal } from "./prompt-reveal";
import type { BattleSoundPlan } from "./attack-audio";
import { collectFreshEvents, emitDuelFxCue, maxEventId } from "./event-queue";
import { duelFontClasses } from "./fonts";
import { armLpHold } from "./life-points";
import { battleCalculation } from "./battle-calculation";
import { ATTACK_TIMING, paceAttack } from "./duel-timing";
import { duelFxClock } from "./fx-clock";
import styles from "./battle-fx.module.css";
import fieldStyles from "./field.module.css";

/**
 * Battle effects, drawn in one fixed overlay over the field and under the prompts (pointer-events: none).
 *
 *  - Attack playback: engine "attack" events, for both players and the bot. An attack event only
 *    DECLARES the attack: it marks the attacker and its target (the aim arrow and rings stay up
 *    while the duel waits for responses). The full animation starts when the battle RESOLVES, on its
 *    battle damage or battle destroy event (battle-trigger.ts); a negated attack plays none. The attacker's
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
export const BATTLE_TOTAL_MS = paceAttack(1250);
/** Reduced motion: flashes and fades only. */
export const BATTLE_REDUCED_MS = ATTACK_TIMING.reducedTotalMs;
/** Reference impact time. Each style lands between about 620 and 790 ms; the LP roll waits for the real one. */
export const BATTLE_IMPACT_MS = paceAttack(490);

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
  /** A terminal result removes calculation plates even if the core never ends the Damage Step. */
  result?: DuelEngineView["result"];
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
type BattleCard = AttackCardLike & { position?: number; attack?: number; defense?: number };
type CardIndex = Map<string, BattleCard>;

/** The monsters of the engine view, by zone key. */
function indexSeats(seats: readonly DuelSeatView[] | undefined): CardIndex {
  const index: CardIndex = new Map();
  for (const seat of seats ?? []) {
    for (const card of seat.monsters) {
      if (!card) continue;
      index.set(zoneKey(card.controller, card.location, card.sequence), {
        code: card.code, name: card.name, race: card.race, attribute: card.attribute, position: card.position,
        attack: card.attack, defense: card.defense,
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
  const previous = prev.get(key), current = now.get(key);
  // A casualty's slot can already hold a replacement. Keep the identity that matches retained art.
  const known = previous ?? current ?? {};
  // A declaration and calculation can share a snapshot that already queries temporary stats.
  // Keep the same card's pre-calculation board values for the plate comparison, but its newest pose.
  const art = node.querySelector("[data-card-art]");
  return { ...known, position: current?.code === known.code ? current?.position ?? known.position : known.position,
    code: known.code ?? codeFromArt(art) };
}

/* ---------- capture (before the new snapshot reaches the DOM) ---------- */

type CutSource = FxCut & { defense: boolean };
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
  /** The attacker / target stands on the far side of the table: its picture is turned half a circle. */
  attackerTurned: boolean;
  targetTurned: boolean;
  /** LP tally boxes by seat, for the damage flash. */
  lp: Record<number, Box | undefined>;
};

function keyOfZone(zone: { controller: number; location: number; sequence: number }): string {
  return zoneKey(zone.controller, zone.location, zone.sequence);
}

/** Reorient retained art without letting a declaration snapshot override the core's battle pose. */
function orientCut(cut: CutSource | null, card: BattleCard | null): CutSource | null {
  if (!cut || card?.position == null) return cut;
  const defense = isDefense(card.position);
  const holder = document.createElement("div");
  holder.innerHTML = cut.html;
  const art = holder.firstElementChild as HTMLElement | null;
  if (!art) return cut;
  art.dataset.defense = defense ? "true" : "false";
  // A batched flip and casualty can remove a Set monster before its revealed DOM face commits.
  if (!isFacedown(card.position) && card.code && !art.querySelector("img")) {
    art.className = fieldStyles.cardFace;
    const img = document.createElement("img");
    img.className = fieldStyles.art;
    img.src = cardArtUrl(card.code, "small");
    img.alt = "";
    img.draggable = false;
    art.replaceChildren(img);
  }
  // Sleeves normally inherit the turn from artWrap, which is outside this retained copy.
  if (!art.querySelector("img")) art.style.transform = defense ? "rotate(90deg)" : "";
  else art.style.removeProperty("transform");
  const box = defense === cut.defense ? cut.box : {
    left: cut.box.left + (cut.box.width - cut.box.height) / 2,
    top: cut.box.top + (cut.box.height - cut.box.width) / 2,
    width: cut.box.height, height: cut.box.width,
  };
  return { ...cut, box, html: art.outerHTML, defense };
}

function cutSourceOf(node: HTMLElement, card: BattleCard): CutSource | null {
  const art = node.querySelector<HTMLElement>("[data-card-art]");
  if (!art) return null;
  const box = boxOf(art);
  if (box.width <= 0 || box.height <= 0) return null;
  // The copy is drawn outside its zone, so it carries the opponent's half turn (field.module.css) as an attribute.
  let html = art.outerHTML;
  if (art.closest('[data-side="opp"]')) {
    const clone = art.cloneNode(true) as HTMLElement;
    clone.setAttribute("data-turned", "true");
    html = clone.outerHTML;
  }
  const defense = node.dataset.defense === "true";
  return orientCut({ box, innerW: art.offsetWidth || (defense ? box.height : box.width),
    innerH: art.offsetHeight || (defense ? box.width : box.height), html, defense }, card);
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
  const attackerCard = readCard(fromKey, fromNode, prev, now);
  const attacker = cutSourceOf(fromNode, attackerCard);
  const base = {
    from: attacker?.box ?? from,
    attacker,
    fromEl: fromNode.querySelector("[data-card-art]"),
    attackerCard,
    attackerTurned: fromNode.closest('[data-side="opp"]') != null,
    lp,
  };
  if (event.target) {
    const targetKey = keyOfZone(event.target);
    const node = zoneNode(targetKey);
    if (!node) return null;
    const targetCard = readCard(targetKey, node, prev, now);
    const target = cutSourceOf(node, targetCard);
    const to = target?.box ?? boxOf(node);
    if (to.width <= 0 || to.height <= 0) return null;
    const targetInDefense = targetCard.position == null ? node.dataset.defense === "true" : isDefense(targetCard.position);
    return { ...base, to, direct: false, target, toEl: node.querySelector("[data-card-art]"), targetCard, targetInDefense, targetTurned: node.closest('[data-side="opp"]') != null };
  }
  const to = lpBox(1 - zone.controller);
  if (!to) return null;
  return { ...base, to, direct: true, target: null, toEl: null, targetCard: null, targetInDefense: false, targetTurned: false };
}

function battleCapture(capture: AttackCapture, events: readonly DuelEvent[], attack: DuelEvent): AttackCapture {
  let attackerCard = capture.attackerCard, targetCard = capture.targetCard;
  for (const event of [...events].filter(e => e.id > attack.id).sort((a, b) => a.id - b.id)) {
    if (event.kind === "attack" || event.kind === "phase") break;
    const zone = event.kind === "move" ? event.from : event.zone;
    const position = event.kind === "position" ? event.toPosition : event.kind === "move" || event.kind === "destroy" ? event.fromPosition : undefined;
    if (!zone || position == null) continue;
    if (attack.zone && keyOfZone(zone) === keyOfZone(attack.zone)) {
      attackerCard = { ...attackerCard, ...(attackerCard.code == null ? event.card : {}), position };
    }
    if (targetCard && attack.target && keyOfZone(zone) === keyOfZone(attack.target)) {
      targetCard = { ...targetCard, ...(targetCard.code == null ? event.card : {}), position };
    }
  }
  const calculation = battleCalculation(events, attack);
  if (calculation) attackerCard = { ...attackerCard, position: calculation.attacker.position };
  if (targetCard && calculation?.target) targetCard = { ...targetCard, position: calculation.target.position };
  const attacker = orientCut(capture.attacker, attackerCard), target = orientCut(capture.target, targetCard);
  return { ...capture, attackerCard, targetCard, attacker, target, from: attacker?.box ?? capture.from,
    to: target?.box ?? capture.to, targetInDefense: targetCard?.position == null ? capture.targetInDefense : isDefense(targetCard.position) };
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
  /** What the fight sounds like (sent to the audio layer when it starts). */
  sound: BattleSoundPlan;
  stats: Array<{ role: "attacker" | "target"; box: Box; value: number; label: "ATK" | "DEF"; above: boolean }>;
};

/** The signature passcode when the card plays a signature attack, else null. */
function signatureOf(style: ReturnType<typeof attackStyleFor>, card: BattleCard | null): number | null {
  return style.rule.startsWith("signature") && card?.code != null ? card.code : null;
}

type Resolved = {
  kind: BattleKind;
  outcome: BattleOutcome;
  attackerStyle: ReturnType<typeof attackStyleFor>;
  defenderStyle: ReturnType<typeof attackStyleFor> | null;
  timing: BattleTiming;
};

/** Reduced motion: one flash on each side, the loser fades; no travel. */
function reducedTiming(kind: BattleKind): BattleTiming {
  // Same order as the full play (hit, then the counter, then the break), only shorter.
  const counter = hasCounterStrike(kind);
  return {
    impactMs: ATTACK_TIMING.reducedImpactMs,
    attackerDamageMs: counter ? ATTACK_TIMING.reducedCounterMs : ATTACK_TIMING.reducedImpactMs + 160,
    targetBreakMs: kind === "win" ? ATTACK_TIMING.reducedBreakMs : kind === "tie" ? ATTACK_TIMING.reducedBreakTieMs : null,
    attackerBreakMs: kind === "lose" || kind === "tie" ? ATTACK_TIMING.reducedBreakTieMs : null,
    totalMs: BATTLE_REDUCED_MS + (counter && kind !== "bounce" ? ATTACK_TIMING.reducedCounterExtraMs : 0),
  };
}

/** Pure: who fights, how it ends, and when things land. Called at capture (LP holds) and at play time. */
function resolveBattle(capture: AttackCapture, events: readonly DuelEvent[], attack: DuelEvent, reduced: boolean): Resolved {
  const outcome = battleOutcome(events, attack);
  // A blow that bounces off a Defense Position monster hurts the attacker's own controller.
  const attackerHurt = battleDamageEvents(events, attack).some((event) => event.seat === attack.zone?.controller);
  const kind = battleKind(capture.direct, outcome, attackerHurt);
  const attackerStyle = attackStyleFor(capture.attackerCard);
  const defenderStyle = capture.direct ? null : attackStyleFor(capture.targetCard);
  const timing = reduced ? reducedTiming(kind) : battleTiming(kind, attackerStyle.style, defenderStyle?.style ?? null);
  return { kind, outcome, attackerStyle, defenderStyle, timing };
}

/** The battle damage that follows an attack. Effect damage in a response window is not the fight's. */
function battleDamageEvents(events: readonly DuelEvent[], attack: DuelEvent): DuelEvent[] {
  return events.filter((event) => {
    if (event.kind !== "damage" || event.id <= attack.id || event.seat == null) return false;
    return event.cause == null || event.cause === "battle";
  });
}

/** When the LP roll for `event` starts: the counter's impact for damage to the attacker, else the strike's impact. */
function damageDelay(event: DuelEvent, attack: DuelEvent, direct: boolean, timing: BattleTiming): number {
  // The number moves a beat after the blow lands, so the hit is seen first and then felt.
  const hitAt = !direct && event.seat === attack.zone?.controller ? timing.attackerDamageMs : timing.impactMs;
  return hitAt + ATTACK_TIMING.lpAfterHitMs;
}

function buildPlay(seq: number, capture: AttackCapture, reduced: boolean, events: readonly DuelEvent[], attack: DuelEvent, layer3d = false, board?: CardIndex): Play | null {
  const resolved = resolveBattle(capture, events, attack, reduced);
  const { kind, timing, attackerStyle, defenderStyle } = resolved;
  const calculation = battleCalculation(events, attack);
  const stats: Play["stats"] = [];
  if (calculation) {
    const differs = (board: BattleCard | null, stats: { attack: number; defense: number }) =>
      (board?.attack != null && board.attack !== stats.attack) || (board?.defense != null && board.defense !== stats.defense);
    const liveAttacker = attack.zone ? board?.get(keyOfZone(attack.zone)) : null;
    const liveTarget = attack.target ? board?.get(keyOfZone(attack.target)) : null;
    // A battle casualty is no longer on the board, even if a floater has filled its slot with another copy.
    const attackerBoard = !resolved.outcome.attacker && liveAttacker?.code != null && liveAttacker.code === capture.attackerCard.code ? liveAttacker : capture.attackerCard;
    const targetBoard = !resolved.outcome.target && liveTarget?.code != null && liveTarget.code === capture.targetCard?.code ? liveTarget : capture.targetCard;
    if (differs(attackerBoard, calculation.attacker)) {
      stats.push({ role: "attacker", box: capture.from, value: calculation.attacker.attack, label: "ATK", above: capture.from.top < capture.to.top });
    }
    if (calculation.target && !capture.direct && differs(targetBoard, calculation.target)) {
      const defense = isDefense(calculation.target.position);
      stats.push({ role: "target", box: capture.to, value: defense ? calculation.target.defense : calculation.target.attack,
        label: defense ? "DEF" : "ATK", above: capture.to.top < capture.from.top });
    }
  }
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
    lpHits, seed: (attack.id * 2654435761) >>> 0, timing, layer3d,
  };
  const sound: BattleSoundPlan = {
    kind, reduced, timing, seed: fx.seed, lpAt: lpHits.map((hit) => hit.at),
    attacker: { style: attackerStyle.style, signature: signatureOf(attackerStyle, capture.attackerCard) },
    defender: defenderStyle ? { style: defenderStyle.style, signature: signatureOf(defenderStyle, capture.targetCard) } : null,
  };
  return {
    seq, reduced, fx, style: attackerStyle.style,
    counterStyle: hasCounterStrike(kind) && defenderStyle ? defenderStyle.style : null,
    kind, totalMs: timing.totalMs, sound, stats,
  };
}

/* ---------- attack playback ---------- */

function AttackPlay({ play, showStats }: { play: Play; showStats: boolean }) {
  const htmlRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Each play mounts with its own key; CSS advances itself after this initial seek.
  const [delayMs] = useState(() => -battleSeekMs(play.fx.startedAt));

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
      style={{ "--total": `${play.totalMs}ms`, animationDelay: `${delayMs}ms` } as CSSProperties}
    >
      <div ref={htmlRef} className={styles.htmlLayer} />
      <svg ref={svgRef} className={styles.svg} aria-hidden />
      {showStats ? play.stats.map(stat => (
        <span key={stat.role} className={styles.calculationStat} data-battle-stat={stat.role}
          data-edge={stat.above ? "top" : "bottom"}
          title="Damage calculation"
          style={{ left: stat.box.left + stat.box.width / 2,
            top: `calc(${stat.above ? stat.box.top : stat.box.top + stat.box.height}px ${stat.above ? "-" : "+"} 6 * var(--fx-unit))` }}>
          <strong>{stat.value}</strong> <small>{stat.label}</small>
        </span>
      )) : null}
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

/**
 * The card(s) a fight destroyed stay on their zones until the killing strike (the counter strike,
 * when the attacker loses) has landed and its damage shows; SummonFx and MoveFx read the hold when
 * they plan the destroy (see battle-hold.ts). Keyed by the attack and zone, so a repeat render is a no-op.
 */
function armBattleDestroys(events: readonly DuelEvent[], attack: DuelEvent, capture: AttackCapture | null, reduced: boolean, claim3d = false, clock?: BattleClock): void {
  if (!capture || !attack.zone) return;
  const { timing, outcome } = resolveBattle(capture, events, attack, reduced);
  if (outcome.target && attack.target && timing.targetBreakMs != null) {
    armBattleDestroy(`${attack.id}:target`, attack.target, timing.targetBreakMs, clock, claim3d);
  }
  if (outcome.attacker && timing.attackerBreakMs != null) {
    armBattleDestroy(`${attack.id}:attacker`, attack.zone, timing.attackerBreakMs, clock, claim3d);
  }
}

/** Damage that follows an attack in the same snapshot rolls when the strike that dealt it lands. */
function armBattleDamage(events: readonly DuelEvent[], attack: DuelEvent, capture: AttackCapture | null, clock: BattleClock): void {
  const timing = capture ? resolveBattle(capture, events, attack, false).timing : null;
  for (const event of battleDamageEvents(events, attack)) {
    const ms = timing ? damageDelay(event, attack, capture?.direct ?? false, timing) : BATTLE_IMPACT_MS;
    armLpHold(event.seat as number, ms, `damage-${event.id}`, clock);
  }
}

/** The fight as the 3D layer plays it, in the canvas space (relative to the host). */
function startBattle3d(capture: AttackCapture, play: Play, clock: BattleClock, controllers: Set<AbortController>): number {
  const shared = getSharedFx3d();
  if (!shared) return 0;
  const host = shared.host.getBoundingClientRect();
  const to = (box: Box): FxRect => viewportToHost(box, host);
  const attackerCard = capture.attackerCard;
  const targetCard = capture.targetCard;
  const { fx } = play;
  const attackerSide = {
    rect: to(fx.attacker.box), code: attackerCard.code ?? 0, style: fx.attacker.style, tint: fx.attacker.tint,
    signature: play.sound.attacker.signature, defense: isDefense(capture.attackerCard.position), turned: capture.attackerTurned,
  };
  const defenderSide = fx.defender
    ? {
        rect: to(fx.defender.box), code: targetCard?.code ?? 0, style: fx.defender.style, tint: fx.defender.tint,
        signature: play.sound.defender?.signature ?? null, defense: capture.targetInDefense, turned: capture.targetTurned,
      }
    : null;
  const battle = planBattle({ kind: fx.kind, timing: fx.timing, attacker: attackerSide, defender: defenderSide, hit: to(fx.hit) });
  for (const code of [attackerSide.code, defenderSide?.code ?? 0]) if (code > 0) shared.api.prefetchArt(code, true);
  const controller = new AbortController();
  controllers.add(controller);
  void shared.api
    .play("battle", { rect: { x: 0, y: 0, w: host.width, h: host.height }, battle, seed: fx.seed, clock, startedAt: clock.startedAt, artCode: attackerSide.code || undefined }, controller.signal)
    .finally(() => controllers.delete(controller));
  return Math.max(0, battle.totalMs - battleSeekMs(clock.startedAt));
}

/** An attack that was declared and has not resolved yet: its board was read at the declaration. */
type PendingAttack = { attack: DuelEvent; capture: AttackCapture | null; at: number };

/** The marker of a declared attack: the attacker and what it attacks stay ringed until it resolves. */
function declaredAim(attack: DuelEvent): BattleAim | null {
  if (!attack.zone) return null;
  const from = keyOfZone(attack.zone);
  if (attack.target) return { mode: "locked", from, to: { zones: [keyOfZone(attack.target)] } };
  return { mode: "locked", from, to: { lpSeat: 1 - attack.zone.controller } };
}

export function BattleFx({ events, reducedMotion, active = true, aim = null, seats, result = null }: BattleFxProps) {
  const [mounted, setMounted] = useState(false);
  const [play, setPlay] = useState<Play | null>(null);
  const [declared, setDeclared] = useState<BattleAim | null>(null);
  const initialRef = useRef<number | null>(null);
  const processedRef = useRef(0);
  const capturesRef = useRef(new Map<number, AttackCapture | null>());
  // The declared attack that waits for its battle to resolve (see battle-trigger.ts).
  const pendingRef = useRef<PendingAttack | null>(null);
  const seqRef = useRef(0);
  // Per attack: which layer draws it (chosen once, in the render phase) and when it started.
  const routeRef = useRef(new Map<number, { three: boolean; clock: BattleClock }>());
  const controllersRef = useRef(new Set<AbortController>());
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
  // A new attack is only read here (its board is captured); the holds are armed for the attack
  // whose battle RESOLVES in this snapshot, which is the pending one or the one declared with it.
  if (active && typeof document !== "undefined") {
    const after = Math.max(initialRef.current, processedRef.current);
    let latest: DuelEvent | null = null;
    for (const event of events) {
      if (event.id > after && event.kind === "attack" && event.zone && (!latest || event.id > latest.id)) latest = event;
    }
    if (latest && !capturesRef.current.has(latest.id)) capturesRef.current.set(latest.id, captureAttack(latest, prevIndexRef.current, nowIndex));
    const stamp = duelFxClock.now();
    const incoming: PendingAttack | null = latest ? { attack: latest, capture: capturesRef.current.get(latest.id) ?? null, at: stamp } : null;
    const ready = [pendingRef.current, incoming].find((entry) => entry != null && battleTrigger(events, entry.attack, stamp - entry.at).action === "play") ?? null;
    if (ready) {
      const cap = ready.capture ? battleCapture(ready.capture, events, ready.attack) : null;
      let route = routeRef.current.get(ready.attack.id);
      if (!route) {
        const three = pickBattleRoute({ reduced: reducedMotion, ready: getSharedFx3d() != null }) === "three" && cap != null;
        route = { three, clock: { startedAt: stamp } };
        routeRef.current.set(ready.attack.id, route);
        if (routeRef.current.size > 20) routeRef.current.delete(routeRef.current.keys().next().value as number);
      }
      if (!reducedMotion && cap && attackImpactAt(ready.attack.id) === 0) {
        noteAttackImpact(ready.attack.id, route.clock.startedAt + resolveBattle(cap, events, ready.attack, false).timing.impactMs);
      }
      if (!reducedMotion) armBattleDamage(events, ready.attack, cap, route.clock);
      armBattleDestroys(events, ready.attack, cap, reducedMotion, route.three, route.clock);
    }
  }

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
      // Event ids restart in the next duel: a hold, claim or impact keyed by an old id must not match it.
      clearBattleHolds();
    };
  }, []);
  useEffect(() => {
    prevIndexRef.current = nowIndex;
  });

  useEffect(() => {
    const after = Math.max(initialRef.current ?? 0, processedRef.current);
    const { nextCursor, fresh } = collectFreshEvents(events, after);
    processedRef.current = nextCursor;
    const forget = () => {
      const keep = pendingRef.current?.attack.id;
      for (const id of Array.from(capturesRef.current.keys())) if (id !== keep) capturesRef.current.delete(id);
    };
    if (!active) {
      pendingRef.current = null;
      setDeclared(null);
      setPlay(null);
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
      clearBattleHolds();
      forget();
      return;
    }
    if (fresh.length === 0) return;
    // A burst (reload, poll catch-up) declares only the newest attack, never the old ones.
    let latest: DuelEvent | null = null;
    for (const event of fresh) if (event.kind === "attack" && event.zone) latest = event;
    const stamp = duelFxClock.now();
    let incoming: PendingAttack | null = null;
    if (latest) {
      const capture = capturesRef.current.get(latest.id) ?? captureAttack(latest, prevIndexRef.current, indexSeats(seats));
      // Load and decode both faces during the declaration/response window, before a possible counter.
      const shared = !reducedRef.current ? getSharedFx3d() : null;
      for (const code of [capture?.attackerCard?.code, capture?.targetCard?.code]) {
        if (code) shared?.api.prefetchArt(code, true);
      }
      incoming = { attack: latest, capture, at: stamp };
    }
    const earlier = pendingRef.current;
    const decide = (entry: PendingAttack | null) => (entry ? battleTrigger(events, entry.attack, stamp - entry.at).action : null);
    // The battle that resolves in this snapshot plays; one that is still open stays pending.
    const ready = [earlier, incoming].find((entry) => decide(entry) === "play") ?? null;
    pendingRef.current = incoming ? (decide(incoming) === "wait" ? incoming : null) : decide(earlier) === "wait" ? earlier : null;
    const marker = pendingRef.current ? declaredAim(pendingRef.current.attack) : null;
    setDeclared((current) => (aimSignature(current) === aimSignature(marker) ? current : marker));
    forget();
    if (!ready) return;
    const resolved = ready.attack;
    const capture = ready.capture ? battleCapture(ready.capture, events, resolved) : null;
    // The destroy events after the attack (in this snapshot) say which card(s) the battle took.
    const route = routeRef.current.get(resolved.id);
    const three = route?.three === true && !reducedRef.current && getSharedFx3d() != null;
    const next = capture ? buildPlay(++seqRef.current, capture, reducedRef.current, events, resolved, three, indexSeats(seats)) : null;
    if (next && capture) {
      const clock = route?.clock ?? { startedAt: duelFxClock.now() };
      joinBattleClock(clock);
      // The 3D fight can outlast the DOM one: its shards keep falling after the last break.
      const long3d = three ? startBattle3d(capture, next, clock, controllersRef.current) : 0;
      next.fx.startedAt = clock.startedAt;
      next.sound.startedAt = clock.startedAt;
      if (!reducedRef.current) noteAttackImpact(resolved.id, clock.startedAt + next.fx.timing.impactMs);
      holdPromptReveal(Math.max(0, next.totalMs - battleSeekMs(clock.startedAt), long3d));
      emitDuelFxCue({ cue: "battle", strength: 1, battle: next.sound });
      setPlay(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seats` only names cards for a late capture
  }, [events, active]);

  useEffect(() => {
    if (!play) return;
    // The prompts wait for totalMs only; the layer stays until a late break-up (a slow counter
    // strike) has fallen, so its shards are not cut off mid-air.
    const { targetBreakMs, attackerBreakMs } = play.fx.timing;
    const lastBreak = Math.max(targetBreakMs ?? 0, attackerBreakMs ?? 0);
    const lifeMs = play.reduced ? play.totalMs : Math.max(play.totalMs, lastBreak > 0 ? lastBreak + DESTROY_TAIL_MS : 0);
    const elapsed = play.fx.startedAt == null ? 0 : Math.max(0, duelFxClock.now() - play.fx.startedAt);
    const timer = duelFxClock.setTimeout(() => setPlay((current) => (current?.seq === play.seq ? null : current)), Math.max(0, lifeMs + 60 - elapsed));
    return () => duelFxClock.clearTimeout(timer);
  }, [play]);

  if (!mounted) return null;
  const shownAim = aim ?? declared;
  // Rendered where it is mounted, inside the board box, not in a portal at the page root. A fixed layer
  // there sits above the whole board stacking context, so it would cover the prompt panels, which live
  // inside it. In the board context the layer takes --duel-z-fx-front, below --duel-z-prompt. The board
  // has no transformed ancestor, so `position: fixed` still measures against the viewport.
  return (
    <div className={`${styles.layer} ${duelFontClasses}`} aria-hidden>
      {shownAim ? <AimLayer aim={shownAim} reduced={reducedMotion} /> : null}
      {play ? <AttackPlay key={play.seq} play={play} showStats={active && result == null} /> : null}
    </div>
  );
}
