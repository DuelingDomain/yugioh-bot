"use client";

import { useEffect, useRef } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { LOCATION_GRAVE, LOCATION_MZONE, LOCATION_REMOVED, LOCATION_SZONE, zoneKey } from "./constants";
import { armBattleDestroy, attackImpactAt } from "./battle-hold";
import { collectFreshEvents, emitDuelFxCue, maxEventId } from "./event-queue";
import { PIECE_TINTS, groupScenes, isWipePiece, planScene, tintForCode, type SceneCue, type SceneGroup } from "./fx3d/scene-plan";
import { pickBattleRoute } from "./fx3d/routing";
import { getSharedFx3d, viewportToHost } from "./fx3d/shared";
import type { FxField, FxPiles, FxRect, FxRows, FxScene, FxWorld } from "./fx3d/types";
import { safeFxAnimate as safeAnimate } from "./safe-animate";
import { artUpsideDown, screenPose, screenSize, zoneTurnsArt } from "./attack-fx";
import { duelFxClock } from "./fx-clock";
import { chainEffectAt } from "./chain-beats";
import { holdPromptReveal } from "./prompt-reveal";
import { registerDestroyScene } from "./destroy-scene-hold";
import { CARD_FX, MOVE_PACE } from "./duel-timing";

/**
 * The trap and effect destroys: a destroy caused by a card effect (cause "effect") plays a set
 * piece keyed by the source card (Mirror Force, Sakuretsu Armor, Torrential Tribute, Dark Hole,
 * Raigeki, Bottomless Trap Hole, Trap Hole), or a generic piece by source kind. Destroys of one
 * snapshot with the same source are ONE piece (see groupScenes).
 *
 * Like BattleFx it plans in the render phase, while the DOM still shows the board before the
 * snapshot, and arms a battle hold per victim: the card stays on its zone (SummonFx keeps its
 * ghost) until its shards break, and MoveFx sends it to the Graveyard only after they fell
 * (battle-hold.ts). The layer is chosen once: WebGL when the shared canvas can draw and motion is
 * allowed; else the existing crack-and-shatter stays, with a short flash and the piece's first sound.
 */

export type DestroyFxProps = {
  events: readonly DuelEvent[];
  reducedMotion: boolean;
  active?: boolean;
  /** The local seat: it decides which way barriers and waves face. */
  mySeat: number;
};

type Box = { left: number; top: number; width: number; height: number };

/** The DOM fallback: the tint flash, then the plain crack-and-shatter of SummonFx. */
const DOM_FLASH_HOLD_MS = 1000;
type Planned = {
  key: string;
  three: boolean;
  startAt: number;
  scene: FxScene;
  cues: SceneCue[];
  seed: number;
  /** DOM boxes for the fallback flash. */
  flash: Box[];
  /** Wipes: the page card of each victim stays whole on a ghost until the canvas takes it (see wipeGhosts). */
  ghosts: WipeGhost[];
  started: boolean;
  reduced: boolean;
  releaseHold: () => void;
};

type WipeGhost = { box: Box; src: string; defense: boolean; takeMs: number; endMs: number };

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function zoneNode(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-zones~="${key}"]`);
}

function artBox(key: string): { box: Box; node: HTMLElement } | null {
  const node = zoneNode(key);
  if (!node) return null;
  const box = boxOf(node.querySelector("[data-card-art]") ?? node);
  return box.width > 0 && box.height > 0 ? { box, node } : null;
}

function codeOfNode(node: Element): number {
  const src = node.querySelector("[data-card-art] img")?.getAttribute("src") ?? "";
  const match = /\/cards\/(\d+)\/image/.exec(src);
  return match ? Number(match[1]) : 0;
}

function union(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** The bounds of the monster zones of one seat (`count` 5 leaves out the two Extra Monster Zones). */
function monsterRow(seat: number, count = 7): Box | null {
  const boxes: Box[] = [];
  for (let sequence = 0; sequence < count; sequence += 1) {
    const found = artBox(zoneKey(seat, LOCATION_MZONE, sequence));
    if (found) boxes.push(found.box);
  }
  return union(boxes);
}

/** The bounds of the spell/trap zones of one seat (zones 0..4 and the field zone are skipped when empty). */
function stRow(seat: number, count = 8): Box | null {
  const boxes: Box[] = [];
  for (let sequence = 0; sequence < count; sequence += 1) {
    const found = artBox(zoneKey(seat, LOCATION_SZONE, sequence));
    if (found) boxes.push(found.box);
  }
  return union(boxes);
}

/** A graveyard or banish pile of one seat (the whole stack). */
function pileBox(seat: number, location: number): Box | null {
  const node = zoneNode(zoneKey(seat, location, 0));
  if (!node) return null;
  const box = boxOf(node);
  return box.width > 0 && box.height > 0 ? box : null;
}

/** The seats that have a monster row on the board now (two in a duel, three or four at a multi-seat table). */
function boardSeats(): number[] {
  const seats = new Set<number>();
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-zones]"))) {
    for (const key of (node.getAttribute("data-zones") ?? "").split(" ")) {
      const match = /^(\d+):(\d+):/.exec(key);
      if (match && Number(match[2]) === LOCATION_MZONE) seats.add(Number(match[1]));
    }
  }
  return Array.from(seats).sort((a, b) => a - b);
}

/**
 * A field that stands tilted on screen (a plaza field of a 3-way table). The piece is drawn in the frame of that field:
 * `turn` is the angle (rad, counter-clockwise) the frame is turned on screen, and `o` is its pivot (viewport px, y down).
 * Every box is handed to the scene turned back by `turn` about `o`, with the true card size, so the scene sees an upright
 * field and the canvas turns the whole world to match the table.
 */
type Local = { o: { x: number; y: number }; turn: number; card: { w: number; h: number } };

/** The turn of the field of a seat on screen (rad, counter-clockwise), in (-pi/2, pi/2]: the sky stays on the upper half. 0 for an upright or turned-around field. */
function fieldTurn(seat: number): number {
  for (let sequence = 0; sequence < 5; sequence += 1) {
    const found = artBox(zoneKey(seat, LOCATION_MZONE, sequence));
    const art = found?.node.querySelector<HTMLElement>("[data-card-art]");
    const pose = art?.parentElement ? screenPose(art.parentElement) : null;
    if (!pose) continue;
    let turn = (-pose.turn * Math.PI) / 180;
    if (Math.cos(turn) < 0) turn += Math.PI;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    return Math.abs(turn) < 0.017 ? 0 : turn;
  }
  return 0;
}

/** The frame of a tilted field, or null when the field is upright. */
function localFrame(seat: number): Local | null {
  const turn = fieldTurn(seat);
  if (turn === 0) return null;
  const centres: Array<{ x: number; y: number }> = [];
  let card: { w: number; h: number } | null = null;
  for (let sequence = 0; sequence < 5; sequence += 1) {
    const found = artBox(zoneKey(seat, LOCATION_MZONE, sequence));
    if (!found) continue;
    centres.push({ x: found.box.left + found.box.width / 2, y: found.box.top + found.box.height / 2 });
    const art = found.node.querySelector<HTMLElement>("[data-card-art]") ?? found.node;
    if (card) continue;
    const size: { w: number; h: number } | null = screenSize(art);
    if (size) card = { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) };
  }
  if (centres.length === 0 || !card) return null;
  const o = { x: centres.reduce((a, c) => a + c.x, 0) / centres.length, y: centres.reduce((a, c) => a + c.y, 0) / centres.length };
  return { o, turn, card };
}

/** A point of the screen, turned back into the frame of the tilted field. */
function localPoint(l: Local, p: { x: number; y: number }): { x: number; y: number } {
  const dx = p.x - l.o.x;
  const dy = l.o.y - p.y;
  const c = Math.cos(l.turn);
  const s = Math.sin(l.turn);
  return { x: l.o.x + (c * dx + s * dy), y: l.o.y - (-s * dx + c * dy) };
}

/** The box of a card (or a pile), turned back into the frame, with the true card size. */
function localBox(l: Local, box: Box, size: { w: number; h: number } = { w: l.card.w, h: l.card.h }): Box {
  const c = localPoint(l, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
  return { left: c.x - size.w / 2, top: c.y - size.h / 2, width: size.w, height: size.h };
}

/** One card art on a tilted field turned up side down relative to the frame (the field itself is not counted). */
function turnedInFrame(l: Local, node: Element): boolean {
  const art = node.querySelector<HTMLElement>("[data-card-art]");
  const pose = art?.parentElement ? screenPose(art.parentElement) : null;
  const field = pose ? (-pose.turn * Math.PI) / 180 : l.turn;
  return Math.cos(field + (zoneTurnsArt(node) ? Math.PI : 0) - l.turn) < 0;
}

/**
 * One seat's field at a multi-seat table, on screen. `slot` is how the field faces: "you" when its Spell/Trap row is
 * below its monster row (an upright field, like the viewer's in a duel), "opp" when it is above (a turned-around field).
 */
type SeatField = { seat: number; m: Box; st: Box | null; gy: Box | null; banish: Box | null; box: Box; slot: "you" | "opp" };

function seatField(seat: number, l: Local | null = null): SeatField | null {
  if (l) return localSeatField(seat, l);
  // Only the five main zones: the Extra Monster Zones belong to the shared band, not to one field.
  const m = monsterRow(seat, 5);
  if (!m) return null;
  const st = stRow(seat, 5);
  const gy = pileBox(seat, LOCATION_GRAVE);
  const banish = pileBox(seat, LOCATION_REMOVED);
  const box = union([m, st, gy, banish].filter((b): b is Box => b != null)) ?? m;
  const mid = m.top + m.height / 2;
  const slot = st ? (st.top + st.height / 2 < mid ? "opp" : "you") : mid < window.innerHeight / 2 ? "opp" : "you";
  return { seat, m, st, gy, banish, box, slot };
}

/** The field of a seat in the frame of a tilted field: the rows are the bounds of the turned-back cards. */
function localSeatField(seat: number, l: Local): SeatField | null {
  const row = (location: number): Box | null => {
    const boxes: Box[] = [];
    for (let sequence = 0; sequence < 5; sequence += 1) {
      const found = artBox(zoneKey(seat, location, sequence));
      if (found) boxes.push(localBox(l, found.box));
    }
    return union(boxes);
  };
  const m = row(LOCATION_MZONE);
  if (!m) return null;
  const st = row(LOCATION_SZONE);
  const pile = (location: number): Box | null => {
    const box = pileBox(seat, location);
    return box ? localBox(l, box) : null;
  };
  const gy = pile(LOCATION_GRAVE);
  const banish = pile(LOCATION_REMOVED);
  const box = union([m, st, gy, banish].filter((b): b is Box => b != null)) ?? m;
  const slot = st && st.top + st.height / 2 < m.top + m.height / 2 ? "opp" : "you";
  return { seat, m, st, gy, banish, box, slot };
}

/**
 * The frame a wipe is drawn in at a multi-seat table. The scenes know two sides ("you" and "opp") and a world with the
 * origin in the middle. A "single" frame is centred on the one field that is hit (Raigeki, Harpie's Feather Duster).
 * A "pair" frame sits between the caster's field and the hit field (Mirror Force). A "table" frame sits on the middle of
 * all fields and is scaled to the whole table (Dark Hole, Torrential Tribute, Heavy Storm: every field is hit).
 */
type MultiFrame = {
  kind: "single" | "pair" | "table";
  /** The middle of the world (canvas px, y down). */
  centre: { x: number; y: number };
  /** Canvas px per world unit. */
  u: number;
  fields: SeatField[];
  /** The field of each slot, and the slot of each seat. */
  rows: { you: SeatField | null; opp: SeatField | null };
  slots: Map<number, "you" | "opp">;
  ownerSide: "you" | "opp";
  /** Single frame: the hit field with room above it for the sky and the head of the beam. */
  focus: Box | null;
  /** Single frame on a tilted field: the boxes of the frame are turned back by this, the canvas turns the world. */
  local?: Local | null;
};

function multiFrame(piece: string, victimSeats: readonly number[], owner: number, seats: readonly number[], cardW: number, local: Local | null = null): MultiFrame | null {
  const all = seats.map((seat) => seatField(seat)).filter((f): f is SeatField => f != null);
  if (all.length < 3) return null;
  const hit = Array.from(new Set(victimSeats));
  const bySeat = new Map(all.map((f) => [f.seat, f]));
  const slots = new Map<number, "you" | "opp">(all.map((f) => [f.seat, f.slot]));
  const mid = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
  const uCard = Math.max(0.1, cardW / 96);
  const caster = bySeat.get(owner) ?? null;
  const target = hit.length === 1 ? (local ? seatField(hit[0], local) : bySeat.get(hit[0])) ?? null : null;

  if (target && (piece === "raigeki" || piece === "feather-duster" || piece === "banish-all")) {
    const rows = { you: target.slot === "you" ? target : null, opp: target.slot === "opp" ? target : null };
    // Room above the field for the sky and the head of the beam, kept on the screen.
    const room = local ? cardW * 1.3 : Math.min(target.box.top, cardW * 1.3);
    const focus = { left: target.box.left, top: target.box.top - room, width: target.box.width, height: target.box.height + room };
    if (local) slots.set(target.seat, target.slot);
    const ownerSide = local ? (target.slot === "you" ? "opp" : "you") : caster?.slot ?? "you";
    return { kind: "single", centre: local ? local.o : mid(target.box), u: uCard, fields: [target], rows, slots, ownerSide, focus, local };
  }
  if (piece === "mirror-force" && caster && target && caster.seat !== target.seat) {
    const a = mid(caster.m);
    const b = mid(target.m);
    if (Math.abs(a.y - b.y) > caster.m.height * 0.6) {
      // Fields in different rows: the wall stands between them, the lower field is "you".
      const lower = a.y >= b.y ? caster : target;
      const upper = lower === caster ? target : caster;
      slots.set(lower.seat, "you");
      slots.set(upper.seat, "opp");
      return { kind: "pair", centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, u: uCard, fields: [caster, target], rows: { you: lower, opp: upper }, slots, ownerSide: slots.get(caster.seat) ?? "you", focus: null };
    }
    // Two fields in one row: the wall stands in front of the caster's row.
    slots.set(caster.seat, "you");
    slots.set(target.seat, "opp");
    return { kind: "pair", centre: a, u: uCard, fields: [caster, target], rows: { you: caster, opp: null }, slots, ownerSide: "you", focus: null };
  }
  // Every field: the middle of all rows, scaled so the whole table is as wide as the board of a duel.
  const zones = union(all.flatMap((f) => (f.st ? [f.m, f.st] : [f.m]))) ?? all[0].m;
  const u = Math.max(uCard, zones.width / 1000, zones.height / 760);
  const firstOf = (slot: "you" | "opp") => all.find((f) => f.slot === slot) ?? null;
  return { kind: "table", centre: mid(zones), u, fields: all, rows: { you: firstOf("you"), opp: firstOf("opp") }, slots, ownerSide: slots.get(owner) ?? "you", focus: null };
}

/** The board zone that holds the card with this passcode in a spell/trap zone or the monster row. */
function sourceBox(code: number, seat: number): Box | null {
  if (code <= 0) return null;
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-zones]"))) {
    const keys = (node.getAttribute("data-zones") ?? "").split(" ");
    if (!keys.some((key) => key.startsWith(`${seat}:`))) continue;
    if (codeOfNode(node) !== code) continue;
    const box = boxOf(node.querySelector("[data-card-art]") ?? node);
    if (box.width > 0) return box;
  }
  return null;
}

function planGroup(group: SceneGroup<DuelEvent>, events: readonly DuelEvent[], mySeat: number, now: number, three: boolean, reduced: boolean, log: readonly DuelEvent[] = events): Planned | null {
  const host = getSharedFx3d()?.host.getBoundingClientRect();
  const toRect = (box: Box): FxRect => (host ? viewportToHost(box, host) : { x: box.left, y: box.top, w: box.width, h: box.height });
  const wipe = isWipePiece(group.piece);
  const victims: Array<{ rect: FxRect; code: number; defense: boolean; turned: boolean; box: Box; event: DuelEvent; st: boolean; src: string; down: boolean; zone: { controller: number; location: number; sequence: number }; node: HTMLElement }> = [];
  for (const event of group.events) {
    // A destroy stands on the zone it was destroyed in; a banish or send is a move that leaves `from`.
    const zone = event.kind === "move" ? event.from : event.zone;
    if (!zone) continue;
    const found = artBox(zoneKey(zone.controller, zone.location, zone.sequence));
    if (!found) continue;
    // The board still shows the card as the viewer saw it: a zone with card art and no face image is face-down.
    // Its face is not shown before the hit (the card is cast with its sleeve), whatever the event knows about it.
    const src = found.node.querySelector("[data-card-art] img")?.getAttribute("src") ?? "";
    const down = src === "" && found.node.querySelector("[data-card-art]") != null;
    victims.push({
      rect: toRect(found.box),
      code: down ? 0 : event.card && event.card.code > 0 ? event.card.code : codeOfNode(found.node),
      defense: found.node.getAttribute("data-defense") === "true",
      turned: artUpsideDown(found.node, found.node.querySelector<HTMLElement>("[data-card-art]")),
      box: found.box,
      event,
      st: zone.location !== LOCATION_MZONE,
      src,
      down,
      zone,
      node: found.node,
    });
  }
  if (victims.length === 0) return null;
  const firstZone = victims[0].zone;
  // Three or four seats: the two-seat rule (the other seat is the caster) and the two-slot world do not hold.
  const seats = wipe ? boardSeats() : [];
  const multi = seats.length > 2;
  // Two fields on the board: a duel, or the face-off of a 3-way or 4-way table (the seats that left have no field). The
  // two are the seats on the board, which are not always seats 0 and 1. "you" is the viewer's field, else the lower one.
  const pairSeats = seats.length === 2 ? seats : [mySeat, 1 - mySeat];
  const lowerSeat = () => {
    const [a, b] = pairSeats;
    const rowA = monsterRow(a, 5);
    const rowB = monsterRow(b, 5);
    return rowA && rowB && rowA.top < rowB.top ? b : a;
  };
  const youSeat = pairSeats.includes(mySeat) ? mySeat : lowerSeat();
  const owner = group.sourceSeat >= 0 ? group.sourceSeat : multi || seats.length === 2 ? seats.find((seat) => seat !== firstZone.controller) ?? 0 : 1 - firstZone.controller;
  let ownerSide: "you" | "opp" = owner === youSeat ? "you" : "opp";
  const source = sourceBox(group.sourceCode, owner);
  let sourceTurned: Box | null = null;
  // Mirror Force is set off by an attack from an EARLIER snapshot, so it looks through the whole log.
  const attackEvent = [...(group.piece === "mirror-force" ? log : events)].reverse().find((event) => event.kind === "attack" && event.zone && event.id < group.events[0].id);
  const attackerFound = group.piece === "mirror-force" || group.piece === "sakuretsu" || group.piece === "trap-hole"
    ? attackEvent?.zone ? artBox(zoneKey(attackEvent.zone.controller, attackEvent.zone.location, attackEvent.zone.sequence)) : null
    : null;
  const rows: Box[] = [];
  const rowSeats = group.piece === "mirror-force" ? [owner] : Array.from(new Set(victims.map((v) => v.zone.controller)));
  for (const seat of rowSeats) {
    const row = monsterRow(seat, multi ? 5 : 7);
    if (row) rows.push(row);
  }
  const field = union(rows) ?? union(victims.map((v) => v.box)) ?? victims[0].box;
  // A destroy that is the effect of a resolving chain link starts while its badge is lit, never before.
  const startAt = Math.max(now, ...group.events.map((event) => chainEffectAt(event.id)));
  const attackImpact = attackEvent ? attackImpactAt(attackEvent.id) : 0;

  // Wipes: the world of the demo (origin = middle of all card zones, u = card width / 96), rows and piles.
  let world: FxWorld | undefined;
  let rowRects: FxRows | undefined;
  let pileRects: FxPiles | undefined;
  let fieldRects: FxField[] | undefined;
  let focusRect: FxRect | undefined;
  let frame: MultiFrame | null = null;
  const seatOf = (seat: number): "you" | "opp" => (seat === youSeat ? "you" : "opp");
  if (wipe) {
    const sample = artBox(zoneKey(firstZone.controller, LOCATION_MZONE, 0)) ?? artBox(zoneKey(1 - firstZone.controller, LOCATION_MZONE, 0));
    // One opponent's tilted field (Raigeki and the like): the piece is drawn in the frame of that field.
    const hitSeats = Array.from(new Set(victims.map((v) => v.zone.controller)));
    const local = multi && hitSeats.length === 1 && (group.piece === "raigeki" || group.piece === "feather-duster" || group.piece === "banish-all") ? localFrame(hitSeats[0]) : null;
    const cardW = local ? local.card.w : sample ? Math.min(sample.box.width, sample.box.height) : Math.min(victims[0].box.width, victims[0].box.height);
    frame = multi ? multiFrame(group.piece, victims.map((v) => v.zone.controller), owner, seats, cardW, local) : null;
    if (frame?.local) {
      const l = frame.local;
      for (const v of victims) {
        v.rect = toRect(localBox(l, v.box));
        v.turned = turnedInFrame(l, v.node);
      }
      if (source) sourceTurned = localBox(l, source);
    }
    if (frame) {
      // A multi-seat table: the frame picks the middle of the world and which field is "you" and which "opp".
      const rectsOf = (f: SeatField | null) => ({ m: f ? toRect(f.m) : null, st: f?.st ? toRect(f.st) : null });
      const pilesOf = (f: SeatField | null) => ({ gy: f?.gy ? toRect(f.gy) : null, banish: f?.banish ? toRect(f.banish) : null });
      rowRects = { you: rectsOf(frame.rows.you), opp: rectsOf(frame.rows.opp) };
      pileRects = { you: pilesOf(frame.rows.you), opp: pilesOf(frame.rows.opp) };
      fieldRects = frame.fields.map(rectsOf);
      if (frame.focus) {
        // The room above the field stops at the top of the canvas.
        const f = toRect(frame.focus);
        const cut = frame.local ? 0 : Math.max(0, -f.y);
        focusRect = { x: f.x, y: f.y + cut, w: f.w, h: f.h - cut };
      }
      ownerSide = frame.ownerSide;
      const origin = toRect({ left: frame.centre.x, top: frame.centre.y, width: 0, height: 0 });
      world = { cx: origin.x, cy: origin.y, u: frame.u, vw: host?.width ?? 1, vh: host?.height ?? 1, ...(frame.local ? { rot: frame.local.turn } : {}) };
    } else {
      const mine = pairSeats;
      const all: Box[] = [];
      rowRects = { you: { m: null, st: null }, opp: { m: null, st: null } };
      pileRects = { you: { gy: null, banish: null }, opp: { gy: null, banish: null } };
      for (const seat of mine) {
        const side = seatOf(seat);
        const m = monsterRow(seat);
        const st = stRow(seat);
        if (m) all.push(m);
        if (st) all.push(st);
        rowRects[side] = { m: m ? toRect(m) : null, st: st ? toRect(st) : null };
        const gy = pileBox(seat, LOCATION_GRAVE);
        const banish = pileBox(seat, LOCATION_REMOVED);
        pileRects[side] = { gy: gy ? toRect(gy) : null, banish: banish ? toRect(banish) : null };
      }
      const zones = union(all) ?? field;
      const zr = toRect(zones);
      world = { cx: zr.x + zr.w / 2, cy: zr.y + zr.h / 2, u: Math.max(0.1, cardW / 96), vw: host?.width ?? zr.w, vh: host?.height ?? zr.h };
    }
  }
  const pileOf = (victim: (typeof victims)[number]): FxRect | null => {
    if (!pileRects) return null;
    const to = victim.event.kind === "move" ? victim.event.zone : null;
    const banish = to != null ? to.location === LOCATION_REMOVED : group.piece === "banish-all";
    if (frame) {
      // Each card goes to the pile of its own seat, whichever slot that seat has.
      const f = frame.fields.find((x) => x.seat === victim.zone.controller) ?? seatField(victim.zone.controller);
      const box = f ? (banish ? f.banish : f.gy) : null;
      return box ? toRect(box) : null;
    }
    const side = seatOf(victim.zone.controller);
    return banish ? pileRects[side].banish : pileRects[side].gy;
  };

  const { scene, cues } = planScene({
    piece: group.piece,
    victims: victims.map((v) => ({ rect: v.rect, code: v.code, defense: v.defense, turned: v.turned, st: v.st, pile: pileOf(v), side: frame?.slots.get(v.zone.controller) })),
    source: sourceTurned ? toRect(sourceTurned) : source ? toRect(source) : null,
    attacker: attackerFound ? toRect(attackerFound.box) : null,
    field: toRect(field),
    ownerSide,
    tint: group.piece === "monster" ? tintForCode(group.sourceCode) : PIECE_TINTS[group.piece],
    attackImpactMs: attackImpact > startAt ? attackImpact - startAt : null,
    world,
    rows: rowRects,
    piles: pileRects,
    fields: fieldRects,
    focus: focusRect,
    // The turn-order strip is drawn at a multi-seat table only (also when two seats are left), never at a 1v1 duel.
    multiTable: wipe && document.querySelector('[data-testid="seat-strip"]') != null,
    sequential: group.events.some((event) => event.sourceKind === "spell" || event.sourceKind === "trap"),
  });
  const ghosts: WipeGhost[] = [];
  const arm = (at: number) => {
    if (!three) return;
    // The victims stay on their zones until their shards break: SummonFx keeps the ghosts, MoveFx waits.
    // A wipe keeps its own ghost whole until the canvas takes the card (takeMs); the move to the pile waits for endMs.
    scene.victims.forEach((victim, index) => {
      const v = victims[index];
      const event = v.event;
      if (wipe) {
        const takeMs = victim.takeMs ?? 0;
        armBattleDestroy(`scene:${group.key}:${event.id}:${at}`, v.zone, takeMs, at, true, { moveAfterMs: victim.endMs ?? victim.atMs });
      } else if (event.zone) {
        armBattleDestroy(`scene:${group.key}:${event.id}:${at}`, event.zone, victim.atMs, at, true);
      }
    });
  };
  arm(startAt);
  if (three && wipe) scene.victims.forEach((victim, index) => {
    const v = victims[index];
    // A face-down victim gets a sleeve ghost (no src), so its zone is never blank before the canvas takes the card.
    if (v.src || v.down) ghosts.push({ box: v.box, src: v.src, defense: v.defense, takeMs: victim.takeMs ?? 0, endMs: victim.endMs ?? victim.atMs });
  });
  const planned: Planned = {
    key: `${group.key}:${group.events[0].id}`,
    three,
    startAt,
    scene,
    cues,
    seed: (group.events[0].id * 2654435761) >>> 0,
    flash: victims.map((v) => v.box),
    ghosts,
    started: false,
    reduced,
    releaseHold: () => {},
  };
  // Without the canvas the card breaks at destroyBreakMs and its pieces take over then (no empty zone in between);
  // the flash plays over them, so the scene lasts until the flash ends.
  const handoffMs = three ? (wipe ? Math.max(...scene.victims.map((victim) => victim.atMs)) : scene.totalMs)
    : reduced ? CARD_FX.reducedEffectMs : MOVE_PACE.destroyBreakMs;
  planned.releaseHold = registerDestroyScene(group.events.map((event) => event.id), {
    startAt, handoffMs, totalMs: three ? scene.totalMs : reduced ? handoffMs : handoffMs + CARD_FX.destroyFlashMs,
    reschedule: (at) => { planned.startAt = at; arm(at); },
  });
  return planned;
}

/**
 * Where the fixed ghosts and flashes go: the board box (the field's parent), so they stack with the other
 * board FX, under the prompts. Appended to the page root they would sit above a prompt panel.
 */
function fxHost(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-duel-field]")?.parentElement ?? document.body;
}

/**
 * Wipes: the page card of each victim is gone from the board when the snapshot renders, so a plain ghost
 * of it stays where it stood, whole, until the canvas takes over at `takeMs` (the canvas draws the same
 * card in the same place). The ghost is hidden then, with no fade. Returns the undo.
 */
function wipeGhosts(planned: Planned): () => void {
  const nodes: HTMLElement[] = [];
  const timers: number[] = [];
  for (const ghost of planned.ghosts) {
    const wait = planned.startAt + ghost.takeMs - duelFxClock.now();
    if (wait <= 0) continue;
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "fixed", left: `${ghost.box.left}px`, top: `${ghost.box.top}px`, width: `${ghost.box.width}px`, height: `${ghost.box.height}px`,
      pointerEvents: "none", zIndex: "var(--duel-z-fx-front)", overflow: "hidden",
    });
    // No face image: the card lay face-down, so the ghost is its sleeve (the same art as the break stand-in).
    const img = document.createElement(ghost.src ? "img" : "div") as HTMLImageElement;
    if (ghost.src) {
      img.src = ghost.src;
      img.alt = "";
      img.draggable = false;
    } else {
      Object.assign(img.style, { background: `#120e0c url("/duel/card-back-main-hd.webp") center / cover no-repeat`, border: "1px solid #b08a3e", boxSizing: "border-box" });
    }
    if (ghost.defense) {
      Object.assign(img.style, {
        position: "absolute", left: "50%", top: "50%", width: `${ghost.box.height}px`, height: `${ghost.box.width}px`,
        transform: "translate(-50%, -50%) rotate(90deg)", objectFit: "cover",
      });
    } else {
      Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
    }
    el.appendChild(img);
    fxHost().appendChild(el);
    nodes.push(el);
    timers.push(duelFxClock.setTimeout(() => el.remove(), wait));
  }
  return () => {
    for (const t of timers) duelFxClock.clearTimeout(t);
    for (const n of nodes) n.remove();
  };
}

/** Reduced motion or no canvas: one short tint over each victim, no travel. */
function domFlash(planned: Planned): () => void {
  const nodes: HTMLElement[] = [];
  const anims: Animation[] = [];
  const tint = planned.scene.tint.main.map((c) => Math.round(c * 255)).join(",");
  for (const box of planned.flash) {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
      pointerEvents: "none", zIndex: "calc(var(--duel-z-fx-front) + 1)", borderRadius: "6px", background: `rgba(${tint},0.55)`, opacity: "0",
    });
    fxHost().appendChild(el);
    nodes.push(el);
    {
      const flash = safeAnimate(el, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: planned.reduced ? CARD_FX.reducedEffectMs : 450, easing: "ease-out", fill: "forwards" });
      if (flash) anims.push(flash);
    }
  }
  return () => {
    for (const a of anims) a.cancel();
    for (const n of nodes) n.remove();
  };
}

export function DestroyFx({ events, reducedMotion, active = true, mySeat }: DestroyFxProps) {
  const initialRef = useRef<number | null>(null);
  const processedRef = useRef(0);
  const plannedRef = useRef(new Map<string, Planned>());
  const controllersRef = useRef(new Set<AbortController>());
  const cleanupsRef = useRef(new Set<() => void>());
  const timersRef = useRef(new Set<number>());

  if (initialRef.current == null) initialRef.current = maxEventId(events) ?? 0;

  // Render phase on purpose (see BattleFx): the DOM still shows the board BEFORE this snapshot.
  if (active && typeof document !== "undefined") {
    const after = Math.max(initialRef.current, processedRef.current);
    const fresh = events.filter((event) => event.id > after);
    const groups = groupScenes(fresh);
    if (groups.length > 0) {
      const now = duelFxClock.now();
      const three = pickBattleRoute({ reduced: reducedMotion, ready: getSharedFx3d() != null }) === "three";
      for (const group of groups) {
        const key = `${group.key}:${group.events[0].id}`;
        if (plannedRef.current.has(key)) continue;
        const planned = planGroup(group, fresh, mySeat, now, three, reducedMotion, events);
        if (planned) plannedRef.current.set(key, planned);
      }
    }
  }

  useEffect(() => {
    const after = Math.max(initialRef.current ?? 0, processedRef.current);
    const { nextCursor, fresh } = collectFreshEvents(events, after);
    processedRef.current = nextCursor;
    if (!active || fresh.length === 0) return;
    for (const planned of plannedRef.current.values()) {
      if (planned.started) continue;
      planned.started = true;
      // A chain link's destroy waits for its badge beat; the prompt waits for it as well.
      const wait = Math.max(0, planned.startAt - duelFxClock.now());
      if (planned.three && planned.ghosts.length > 0) cleanupsRef.current.add(wipeGhosts(planned));
      const shared = planned.three ? getSharedFx3d() : null;
      // The prompt waits for what actually plays: the whole piece on the canvas, or (DOM) the flash
      // plus, when holds were armed for the canvas, the held cards breaking on their zones.
      const lastBreak = planned.three ? planned.scene.victims.reduce((max, v) => Math.max(max, v.atMs, v.endMs ?? 0), 0) : 0;
      const playMs = shared ? planned.scene.totalMs : Math.max(DOM_FLASH_HOLD_MS, lastBreak + DOM_FLASH_HOLD_MS);
      holdPromptReveal(Math.max(0, wait + playMs - Math.max(0, duelFxClock.now() - planned.startAt)));
      const begin = () => {
        const late = Math.max(0, duelFxClock.now() - planned.startAt);
        const live = planned.three ? getSharedFx3d() : null;
        if (live) {

          for (const victim of planned.scene.victims) if (victim.code > 0) live.api.prefetchArt(victim.code);
          const host = live.host.getBoundingClientRect();
          const controller = new AbortController();
          controllersRef.current.add(controller);
          void live.api
            .play("scene", { rect: { x: 0, y: 0, w: host.width, h: host.height }, scene: planned.scene, seed: planned.seed, skipMs: Math.min(120, Math.max(0, late)) }, controller.signal)
            .finally(() => controllersRef.current.delete(controller));
          for (const cue of planned.cues) {
            const cueWait = Math.max(0, cue.atMs - late);
            const timer = duelFxClock.setTimeout(() => {
              timersRef.current.delete(timer);
              emitDuelFxCue({ cue: cue.cue, strength: cue.strength });
            }, cueWait);
            timersRef.current.add(timer);
          }
        } else {
          // The plain crack-and-shatter of SummonFx stays; this adds the tint and the first sound.
          if (!reducedMotion) emitDuelFxCue({ cue: planned.cues[0].cue, strength: 0.8 });
          const undo = domFlash(planned);
          cleanupsRef.current.add(undo);
          const timer = duelFxClock.setTimeout(() => {
            timersRef.current.delete(timer);
            undo();
            cleanupsRef.current.delete(undo);
          }, 600);
          timersRef.current.add(timer);
        }
      };
      if (wait > 0) {
        const starter = duelFxClock.setTimeout(() => {
          timersRef.current.delete(starter);
          begin();
        }, wait);
        timersRef.current.add(starter);
      } else {
        begin();
      }
      const plannedKey = planned.key;
      const forget = duelFxClock.setTimeout(() => {
        timersRef.current.delete(forget);
        plannedRef.current.delete(plannedKey);
        planned.releaseHold();
      }, wait + planned.scene.totalMs + 500);
      timersRef.current.add(forget);
    }
  }, [events, active, reducedMotion]);

  useEffect(() => {
    const controllers = controllersRef.current;
    const timers = timersRef.current;
    const cleanups = cleanupsRef.current;
    const planned = plannedRef.current;
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
      for (const timer of timers) duelFxClock.clearTimeout(timer);
      timers.clear();
      for (const undo of cleanups) undo();
      cleanups.clear();
      for (const scene of planned.values()) scene.releaseHold();
      planned.clear();
    };
  }, []);

  return null;
}
