"use client";

import { useEffect, useRef } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { LOCATION_GRAVE, LOCATION_MZONE, LOCATION_REMOVED, LOCATION_SZONE, zoneKey } from "./constants";
import { armBattleDestroy, attackImpactAt } from "./battle-hold";
import { collectFreshEvents, emitDuelFxCue, maxEventId } from "./event-queue";
import { PIECE_TINTS, groupScenes, isWipePiece, planScene, tintForCode, type SceneCue, type SceneGroup } from "./fx3d/scene-plan";
import { pickBattleRoute } from "./fx3d/routing";
import { getSharedFx3d, viewportToHost } from "./fx3d/shared";
import type { FxPiles, FxRect, FxRows, FxScene, FxWorld } from "./fx3d/types";
import { safeFxAnimate as safeAnimate } from "./safe-animate";
import { artUpsideDown } from "./attack-fx";
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

/** The bounds of the monster zones of one seat. */
function monsterRow(seat: number): Box | null {
  const boxes: Box[] = [];
  for (let sequence = 0; sequence < 7; sequence += 1) {
    const found = artBox(zoneKey(seat, LOCATION_MZONE, sequence));
    if (found) boxes.push(found.box);
  }
  return union(boxes);
}

/** The bounds of the spell/trap zones of one seat (zones 0..4 and the field zone are skipped when empty). */
function stRow(seat: number): Box | null {
  const boxes: Box[] = [];
  for (let sequence = 0; sequence < 8; sequence += 1) {
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
  const victims: Array<{ rect: FxRect; code: number; defense: boolean; turned: boolean; box: Box; event: DuelEvent; st: boolean; src: string; down: boolean; zone: { controller: number; location: number; sequence: number } }> = [];
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
    });
  }
  if (victims.length === 0) return null;
  const firstZone = victims[0].zone;
  const owner = group.sourceSeat >= 0 ? group.sourceSeat : 1 - firstZone.controller;
  const ownerSide = owner === mySeat ? "you" : "opp";
  const source = sourceBox(group.sourceCode, owner);
  // Mirror Force is set off by an attack from an EARLIER snapshot, so it looks through the whole log.
  const attackEvent = [...(group.piece === "mirror-force" ? log : events)].reverse().find((event) => event.kind === "attack" && event.zone && event.id < group.events[0].id);
  const attackerFound = group.piece === "mirror-force" || group.piece === "sakuretsu" || group.piece === "trap-hole"
    ? attackEvent?.zone ? artBox(zoneKey(attackEvent.zone.controller, attackEvent.zone.location, attackEvent.zone.sequence)) : null
    : null;
  const rows: Box[] = [];
  const rowSeats = group.piece === "mirror-force" ? [owner] : Array.from(new Set(victims.map((v) => v.zone.controller)));
  for (const seat of rowSeats) {
    const row = monsterRow(seat);
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
  const seatOf = (seat: number): "you" | "opp" => (seat === mySeat ? "you" : "opp");
  if (wipe) {
    const mine = [mySeat, 1 - mySeat];
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
    const sample = artBox(zoneKey(firstZone.controller, LOCATION_MZONE, 0)) ?? artBox(zoneKey(1 - firstZone.controller, LOCATION_MZONE, 0));
    const cardW = sample ? Math.min(sample.box.width, sample.box.height) : Math.min(victims[0].box.width, victims[0].box.height);
    const zr = toRect(zones);
    world = { cx: zr.x + zr.w / 2, cy: zr.y + zr.h / 2, u: Math.max(0.1, cardW / 96), vw: host?.width ?? zr.w, vh: host?.height ?? zr.h };
  }
  const pileOf = (victim: (typeof victims)[number]): FxRect | null => {
    if (!pileRects) return null;
    const side = seatOf(victim.zone.controller);
    const to = victim.event.kind === "move" ? victim.event.zone : null;
    const banish = to != null ? to.location === LOCATION_REMOVED : group.piece === "banish-all";
    return banish ? pileRects[side].banish : pileRects[side].gy;
  };

  const { scene, cues } = planScene({
    piece: group.piece,
    victims: victims.map((v) => ({ rect: v.rect, code: v.code, defense: v.defense, turned: v.turned, st: v.st, pile: pileOf(v) })),
    source: source ? toRect(source) : null,
    attacker: attackerFound ? toRect(attackerFound.box) : null,
    field: toRect(field),
    ownerSide,
    tint: group.piece === "monster" ? tintForCode(group.sourceCode) : PIECE_TINTS[group.piece],
    attackImpactMs: attackImpact > startAt ? attackImpact - startAt : null,
    world,
    rows: rowRects,
    piles: pileRects,
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
