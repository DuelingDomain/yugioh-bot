"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelEngineView, DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, cardArtUrl, isDefense, isFacedown, zoneKey } from "./constants";
import { battleOutcome, type BattleOutcome } from "./battle-outcome";
import { battleTrigger } from "./battle-trigger";
import { attackStyleFor, battleKind, battleTiming, DESTROY_TAIL_MS, hasCounterStrike, type AttackCardLike, type AttackStyleId, type BattleKind, type BattleTiming } from "./attack-styles";
import { artUpsideDown, runAttackFx, screenPose, zoneTurnsArt, type AttackFxPlan, type FxCut, type FxLpHit, type FxSide } from "./attack-fx";
import { flipAttackAt, flipFightDamageAt } from "./chain-beats";
import { FlipStrike, type FlipStrikePlan } from "./flip-strike";
import { flipSequenceSteps } from "./flip-sequence";
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
import { declaredCaption, directTargetSeat } from "./declared-attack";
import { ATTACK_TIMING, paceAttack } from "./duel-timing";
import { duelFxClock } from "./fx-clock";
import { centerOfQuad, elementQuad, growQuad, isTurned, quadBox, quadEdgePoint, roundedQuadPath, type Quad } from "./quad";
import baseStyles from "./battle-fx.module.css";
import { useSkinStyles } from "./skin";
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
  /** "<attacker> attacks <player>": the line every seat reads while the attack is declared. */
  caption?: string;
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
  /** Current engine window; playback visibility follows the captured battle instead. */
  battleStep?: DuelEngineView["battleStep"];
  /** Names a seat in the caption of a declared attack. Optional: "Player N". */
  nameOf?: (seat: number) => string;
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

/** The true outline of a zone's card (it follows a turned field), or null when it is not on screen. */
function zoneQuad(key: string): Quad | null {
  const node = zoneNode(key);
  if (!node) return null;
  const quad = elementQuad(node.querySelector("[data-card-art]") ?? node);
  const box = quadBox(quad);
  return box.width > 0 && box.height > 0 ? quad : null;
}

function lpQuad(seat: number): Quad | null {
  const node = document.querySelector<HTMLElement>(`[data-lp-seat="${seat}"]`);
  if (!node) return null;
  const quad = elementQuad(node.querySelector("strong") ?? node);
  const box = quadBox(quad);
  return box.width > 0 && box.height > 0 ? quad : null;
}

function lpBox(seat: number): Box | null {
  const node = document.querySelector<HTMLElement>(`[data-lp-seat="${seat}"]`);
  if (!node) return null;
  const box = boxOf(node.querySelector("strong") ?? node);
  return box.width > 0 && box.height > 0 ? box : null;
}

/** The LP tally a direct attack hits; null when its defender is not known (no wrong guess in a 3 or 4 seat duel). */
function directLpBox(event: DuelEvent, seatCount: number): Box | null {
  const seat = directTargetSeat(event, seatCount);
  return seat == null ? null : lpBox(seat);
}

type Arrow = { d: string; head: string; start: Pt; tip: Pt };

function arrowBetween(from: Quad, to: Quad): Arrow | null {
  const s = quadEdgePoint(from, centerOfQuad(to), 4);
  const e = quadEdgePoint(to, centerOfQuad(from), 8);
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

/**
 * `w` x `h` is the art's own box on screen (before its Defense turn), `turn` the screen angle of its top edge and
 * `fit` the scale a seat field gives a Defense card (`--dfit`). The copy is drawn outside the field, so it needs them.
 */
type CutSource = FxCut & { defense: boolean; w: number; h: number; fit: number };
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

/**
 * How the art sits on screen: its box size, the angle of its top edge, and the Defense fit of its field.
 * A seat field of a multiplayer table is rotated (and scaled) as a whole, so a copy of the art drawn outside the
 * field must repeat that turn. The art's parent is the art's own box (before its Defense turn); three zero-size
 * probes on its corners give the screen edges. Anything unreadable gives the unturned layout size.
 */
function readPose(art: HTMLElement): { w: number; h: number; turn: number; fit: number } {
  const own = { w: art.offsetWidth, h: art.offsetHeight, turn: 0, fit: 1 };
  const fit = Number.parseFloat(getComputedStyle(art).getPropertyValue("--dfit"));
  if (Number.isFinite(fit) && fit > 0) own.fit = fit;
  const pose = art.parentElement ? screenPose(art.parentElement) : null;
  return pose ? { ...pose, fit: own.fit } : own;
}

/** The pose a card gets in a copy: the Defense quarter turn (scaled to its field) or none. Inline, since the copy has no field around it. */
function defenseTransform(defense: boolean, fit: number): string {
  return defense ? `rotate(90deg) scale(${fit})` : "";
}

/** Bounding box of a w x h card around `centre`, turned by `turn`; in Defense it lies on its side at `fit` scale. */
function cutBox(centre: Pt, w: number, h: number, turn: number, defense: boolean, fit: number): Box {
  const fw = defense ? h * fit : w, fh = defense ? w * fit : h;
  const rad = turn * Math.PI / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const width = fw * cos + fh * sin, height = fw * sin + fh * cos;
  return { left: centre.x - width / 2, top: centre.y - height / 2, width, height };
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
  // The copy sits outside its field, so the field's own Defense rule (and a sleeve's wrapper rule) cannot reach it.
  art.style.transform = defenseTransform(defense, cut.fit);
  const box = defense === cut.defense ? cut.box
    : cutBox({ x: cut.box.left + cut.box.width / 2, y: cut.box.top + cut.box.height / 2 }, cut.w, cut.h, cut.turn ?? 0, defense, cut.fit);
  return { ...cut, box, html: art.outerHTML, defense };
}

function cutSourceOf(node: HTMLElement, card: BattleCard): CutSource | null {
  const art = node.querySelector<HTMLElement>("[data-card-art]");
  if (!art) return null;
  const box = boxOf(art);
  if (box.width <= 0 || box.height <= 0) return null;
  const defense = node.dataset.defense === "true";
  const pose = readPose(art);
  // The copy is drawn outside its zone, so it carries the opponent's half turn (field.module.css) as an attribute.
  const clone = art.cloneNode(true) as HTMLElement;
  // Only the zone turns the art (the clone's field turn comes from screenPose), so ask the zone, not the field.
  if (zoneTurnsArt(node)) clone.setAttribute("data-turned", "true");
  if (defense) clone.style.transform = defenseTransform(true, pose.fit);
  // Without a layout (no readable size) the box on screen is all there is: a Defense card lies on its side in it.
  const w = pose.w || art.offsetWidth || (defense ? box.height : box.width);
  const h = pose.h || art.offsetHeight || (defense ? box.width : box.height);
  return orientCut({ box, innerW: w, innerH: h, html: clone.outerHTML, defense, turn: pose.turn, w, h, fit: pose.fit }, card);
}

/**
 * Reads the board for one attack event. Called while React renders the snapshot that carries the
 * event, which is BEFORE the DOM shows the battle result, so a card that dies still has its art.
 * Both the attacker's and the target's art are kept: which one is cut is decided at play time.
 */
function captureAttack(event: DuelEvent, prev: CardIndex, now: CardIndex, seatCount: number): AttackCapture | null {
  const zone = event.zone;
  if (!zone) return null;
  const fromKey = keyOfZone(zone);
  const fromNode = zoneNode(fromKey);
  const from = fromNode ? zoneBox(fromKey) : null;
  if (!fromNode || !from) return null;
  const lp: Record<number, Box | undefined> = {};
  for (const node of document.querySelectorAll<HTMLElement>("[data-lp-seat]")) {
    const seat = Number(node.dataset.lpSeat);
    lp[seat] = lpBox(seat) ?? undefined;
  }
  const attackerCard = readCard(fromKey, fromNode, prev, now);
  const attacker = cutSourceOf(fromNode, attackerCard);
  const base = {
    from: attacker?.box ?? from,
    attacker,
    fromEl: fromNode.querySelector("[data-card-art]"),
    attackerCard,
    attackerTurned: artUpsideDown(fromNode, fromNode.querySelector<HTMLElement>("[data-card-art]")),
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
    return { ...base, to, direct: false, target, toEl: node.querySelector("[data-card-art]"), targetCard, targetInDefense, targetTurned: artUpsideDown(node, node.querySelector<HTMLElement>("[data-card-art]")) };
  }
  const to = directLpBox(event, seatCount);
  if (!to) return null;
  return { ...base, to, direct: true, target: null, toEl: null, targetCard: null, targetInDefense: false, targetTurned: false };
}

/**
 * The same capture with its screen boxes read again, for a board that moved since the declaration (a drawer opened or closed,
 * the window resized) while the attack waits for its response window. The retained art stays as captured, since the card may
 * not be in its zone any more; a zone or tally that is gone keeps its old box. The input itself when nothing moved.
 */
function remeasureCapture(capture: AttackCapture, event: DuelEvent, seatCount: number): AttackCapture {
  const zone = event.zone;
  if (!zone) return capture;
  const same = (a: Box, b: Box) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  const refreshCut = (cut: CutSource | null, node: HTMLElement | null, card: BattleCard | null): CutSource | null => {
    if (!cut || !node || !card) return cut;
    const fresh = cutSourceOf(node, card);
    return fresh && fresh.defense === cut.defense ? { ...cut, box: fresh.box, innerW: fresh.innerW, innerH: fresh.innerH } : cut;
  };
  const fromNode = zoneNode(keyOfZone(zone));
  const attacker = refreshCut(capture.attacker, fromNode, capture.attackerCard);
  let from = attacker?.box ?? capture.from;
  if (!attacker && fromNode) from = zoneBox(keyOfZone(zone)) ?? from;
  const lp: Record<number, Box | undefined> = { ...capture.lp };
  for (const node of document.querySelectorAll<HTMLElement>("[data-lp-seat]")) {
    const seat = Number(node.dataset.lpSeat);
    lp[seat] = lpBox(seat) ?? lp[seat];
  }
  let target = capture.target;
  let to = capture.to;
  if (capture.direct) {
    to = directLpBox(event, seatCount) ?? to;
  } else if (event.target) {
    const node = zoneNode(keyOfZone(event.target));
    target = refreshCut(capture.target, node, capture.targetCard);
    to = target?.box ?? (node && boxOf(node).width > 0 ? boxOf(node) : to);
  }
  const moved = !same(from, capture.from) || !same(to, capture.to) || Object.keys(lp).some((seat) => {
    const before = capture.lp[Number(seat)], after = lp[Number(seat)];
    return before && after ? !same(before, after) : before !== after;
  });
  return moved ? { ...capture, from, to, attacker, target, lp } : capture;
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
  attackId: number;
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
    const differs = (board: BattleCard | null, stats: { attack: number; defense: number }, stat: "attack" | "defense") =>
      board?.[stat] != null && board[stat] !== stats[stat];
    const liveAttacker = attack.zone ? board?.get(keyOfZone(attack.zone)) : null;
    const liveTarget = attack.target ? board?.get(keyOfZone(attack.target)) : null;
    // A battle casualty is no longer on the board, even if a floater has filled its slot with another copy.
    const attackerBoard = !resolved.outcome.attacker && liveAttacker?.code != null && liveAttacker.code === capture.attackerCard.code ? liveAttacker : capture.attackerCard;
    const targetBoard = !resolved.outcome.target && liveTarget?.code != null && liveTarget.code === capture.targetCard?.code ? liveTarget : capture.targetCard;
    if (differs(attackerBoard, calculation.attacker, "attack")) {
      stats.push({ role: "attacker", box: capture.from, value: calculation.attacker.attack, label: "ATK", above: capture.from.top < capture.to.top });
    }
    if (calculation.target && !isFacedown(calculation.target.position) && !capture.direct && differs(targetBoard, calculation.target, isDefense(calculation.target.position) ? "defense" : "attack")) {
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
    seq, attackId: attack.id, reduced, fx, style: attackerStyle.style,
    counterStyle: hasCounterStrike(kind) && defenderStyle ? defenderStyle.style : null,
    kind, totalMs: timing.totalMs, sound, stats,
  };
}

/* ---------- attack playback ---------- */

function AttackPlay({ play, showStats }: { play: Play; showStats: boolean }) {
  const styles = baseStyles;
  const skinned = useSkinStyles(baseStyles, "battle");
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
        <span key={stat.role} className={skinned.calculationStat} data-battle-stat={stat.role}
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

type AimGeom = { mode: BattleAim["mode"]; from: Quad; arrows: Arrow[]; rings: Quad[] };

function measureAim(aim: BattleAim | null | undefined): AimGeom | null {
  if (!aim?.from) return null;
  const from = zoneQuad(aim.from);
  if (!from) return null;
  const targets: Quad[] = [];
  if (aim.to.lpSeat != null) {
    const quad = lpQuad(aim.to.lpSeat);
    if (quad) targets.push(quad);
  }
  for (const key of aim.to.zones ?? []) {
    const quad = zoneQuad(key);
    if (quad) targets.push(quad);
  }
  const arrows = targets.map((target) => arrowBetween(from, target)).filter((arrow): arrow is Arrow => arrow != null);
  if (arrows.length === 0) return null;
  return { mode: aim.mode, from, arrows, rings: aim.mode === "preview" ? [] : targets };
}

function aimSignature(aim: BattleAim | null | undefined): string {
  if (!aim?.from) return "";
  return `${aim.mode}|${aim.from}|${(aim.to.zones ?? []).join(",")}|${aim.to.lpSeat ?? ""}|${aim.caption ?? ""}`;
}

function AimLayer({ aim, reduced }: { aim: BattleAim; reduced: boolean }) {
  // Classic: the module's own classes. 3D mode: the same keys with the gold aim classes added.
  const styles = useSkinStyles(baseStyles, "battle");
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
  // A straight box stays a rect; a turned or tilted card gets an outline on its real corners.
  const ring = (quad: Quad, index: number, pad: number) => {
    if (isTurned(quad)) return <path key={`ring-${index}`} className={styles.aimRing} data-turned="true" d={roundedQuadPath(growQuad(quad, pad), 9)} />;
    const box = quadBox(quad);
    return (
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
  };
  const lead = geom.arrows[0];
  return (
    <>
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
    {aim.caption ? (
      <span key={`caption-${signature}`} className={styles.aimCaption} data-attack-caption="true"
        style={{ left: (lead.start.x + lead.tip.x) / 2, top: (lead.start.y + lead.tip.y) / 2 }}>
        {aim.caption}
      </span>
    ) : null}
    </>
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
function declaredAim(attack: DuelEvent, seatCount: number, nameOf: (seat: number) => string = defaultName): BattleAim | null {
  if (!attack.zone) return null;
  const from = keyOfZone(attack.zone);
  const caption = declaredCaption(attack, seatCount, nameOf) ?? undefined;
  if (attack.target) return { mode: "locked", from, to: { zones: [keyOfZone(attack.target)] }, caption };
  const lpSeat = directTargetSeat(attack, seatCount);
  return lpSeat == null ? null : { mode: "locked", from, to: { lpSeat }, caption };
}

const defaultName = (seat: number): string => `Player ${seat + 1}`;

export function BattleFx({ events, reducedMotion, active = true, aim = null, seats, result = null, nameOf = defaultName }: BattleFxProps) {
  const [mounted, setMounted] = useState(false);
  const [play, setPlay] = useState<Play | null>(null);
  const [declared, setDeclared] = useState<BattleAim | null>(null);
  // The attack beat of a flip-effect sequence: no battle plays for it (battle-trigger.ts), so it has its own.
  const [strike, setStrike] = useState<(FlipStrikePlan & { aim: BattleAim | null }) | null>(null);
  const initialRef = useRef<number | null>(null);
  const processedRef = useRef(0);
  const capturesRef = useRef(new Map<number, AttackCapture | null>());
  // The declared attack that waits for its battle to resolve (see battle-trigger.ts).
  const pendingRef = useRef<PendingAttack | null>(null);
  const seqRef = useRef(0);
  // Attacks whose strike (a flip-effect sequence) was started.
  const struckRef = useRef(new Set<number>());
  // Per attack: which layer draws it (chosen once, in the render phase) and when it started.
  const routeRef = useRef(new Map<number, { three: boolean; clock: BattleClock }>());
  const controllersRef = useRef(new Set<AbortController>());
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const nameOfRef = useRef(nameOf);
  nameOfRef.current = nameOf;
  // How many seats play: only a 2-seat duel may guess the defender of a direct attack. 0 while the seats are not known.
  const seatCountRef = useRef(0);
  seatCountRef.current = seats?.length ?? 0;
  // The board's monsters as of the last commit, and as of this render: an attack's cards are read
  // from the older one, because the newer snapshot may already have taken the card that died.
  const prevIndexRef = useRef<CardIndex>(new Map());
  const nowIndex = indexSeats(seats);

  // The caption names players that may load after the declaration: re-read them (every commit; it only sets state on a change).
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    const marker = declaredAim(pending.attack, seatCountRef.current, nameOfRef.current);
    setDeclared((current) => (current && aimSignature(current) !== aimSignature(marker) ? marker : current));
  });

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
    if (latest && !capturesRef.current.has(latest.id)) capturesRef.current.set(latest.id, captureAttack(latest, prevIndexRef.current, nowIndex, seatCountRef.current));
    const stamp = duelFxClock.now();
    const incoming: PendingAttack | null = latest ? { attack: latest, capture: capturesRef.current.get(latest.id) ?? null, at: stamp } : null;
    // The battle damage of a flip-effect sequence waits for the strike or the end of its chain (chain-beats.ts).
    if (!reducedMotion) {
      for (const event of events) {
        if (event.id <= initialRef.current || event.kind !== "damage" || event.seat == null) continue;
        const at = flipFightDamageAt(event.id);
        if (at > stamp) armLpHold(event.seat, at - stamp, `damage-${event.id}`, { startedAt: stamp });
      }
    }
    // A flip-effect sequence has its own attack beat (flip-strike.tsx) and no battle play.
    const ready = [pendingRef.current, incoming].find((entry) => entry != null && flipAttackAt(entry.attack.id) === 0 && battleTrigger(events, entry.attack, stamp - entry.at).action === "play") ?? null;
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
  // The board can move while an attack waits for its response window (the table's drawer opens or closes, the window is
  // resized). The wide table pumps a window `resize` for the length of the drawer's glide. The boxes captured at the
  // declaration are read again one frame after the last resize, so the strike plays on the cards where they are now.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const pending = pendingRef.current;
        if (!pending?.capture) return;
        const next = remeasureCapture(pending.capture, pending.attack, seatCountRef.current);
        if (next === pending.capture) return;
        pendingRef.current = { ...pending, capture: next };
        capturesRef.current.set(pending.attack.id, next);
      });
    };
    window.addEventListener("resize", refresh);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", refresh);
    };
  }, [active]);
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
      const capture = capturesRef.current.get(latest.id) ?? captureAttack(latest, prevIndexRef.current, indexSeats(seats), seatCountRef.current);
      // Load and decode both faces during the declaration/response window, before a possible counter.
      const shared = !reducedRef.current ? getSharedFx3d() : null;
      for (const code of [capture?.attackerCard?.code, capture?.targetCard?.code]) {
        if (code) shared?.api.prefetchArt(code, true);
      }
      incoming = { attack: latest, capture, at: stamp };
    }
    const earlier = pendingRef.current;
    const decide = (entry: PendingAttack | null) => (entry ? (flipAttackAt(entry.attack.id) > 0 ? "fizzle" : battleTrigger(events, entry.attack, stamp - entry.at).action) : null);
    // The battle that resolves in this snapshot plays; one that is still open stays pending.
    const ready = [earlier, incoming].find((entry) => decide(entry) === "play") ?? null;
    pendingRef.current = incoming ? (decide(incoming) === "wait" ? incoming : null) : decide(earlier) === "wait" ? earlier : null;
    const marker = pendingRef.current ? declaredAim(pendingRef.current.attack, seatCountRef.current, nameOfRef.current) : null;
    setDeclared((current) => (aimSignature(current) === aimSignature(marker) ? current : marker));
    // The attack beat of a flip-effect sequence: the attack that opened it, in this batch or an earlier one.
    const struck = incoming ?? earlier;
    if (struck?.capture && !struckRef.current.has(struck.attack.id)) {
      const startAt = flipAttackAt(struck.attack.id);
      if (startAt > 0) {
        struckRef.current.add(struck.attack.id);
        if (struckRef.current.size > 20) struckRef.current.delete(struckRef.current.values().next().value as number);
        const reduced = reducedRef.current;
        setStrike({
          seq: ++seqRef.current, from: struck.capture.from, to: struck.capture.to, cut: struck.capture.attacker,
          ms: flipSequenceSteps(reduced).attackMs, reduced,
          delayMs: Math.max(0, startAt - duelFxClock.now()), aim: declaredAim(struck.attack, seatCountRef.current, nameOfRef.current),
        });
      }
    }
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

  // The aim marker and the lunge of the strike end with its beat.
  const strikeSeq = strike?.seq;
  const strikeEnd = strike ? strike.delayMs + strike.ms : 0;
  useEffect(() => {
    if (strikeSeq == null) return;
    const timer = duelFxClock.setTimeout(() => setStrike((current) => (current?.seq === strikeSeq ? null : current)), strikeEnd + 80);
    return () => duelFxClock.clearTimeout(timer);
  }, [strikeSeq, strikeEnd]);

  if (!mounted) return null;
  const strikeAim = strike?.aim ?? null;
  const shownAim = aim ?? declared ?? strikeAim;
  // Rendered where it is mounted, inside the board box, not in a portal at the page root. A fixed layer
  // there sits above the whole board stacking context, so it would cover the prompt panels, which live
  // inside it. In the board context the layer takes --duel-z-fx-front, below --duel-z-prompt. The board
  // has no transformed ancestor, so `position: fixed` still measures against the viewport.
  return (
    <div className={`${baseStyles.layer} ${duelFontClasses}`} aria-hidden>
      {shownAim ? <AimLayer aim={shownAim} reduced={reducedMotion} /> : null}
      {strike ? <FlipStrike key={strike.seq} plan={strike} /> : null}
      {play ? <AttackPlay key={play.seq} play={play}
        showStats={active && result == null && !events.some(event => event.id > play.attackId && (event.kind === "attack" || event.kind === "phase"))} /> : null}
    </div>
  );
}
