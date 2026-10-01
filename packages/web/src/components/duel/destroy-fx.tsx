"use client";

import { useEffect, useRef } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { LOCATION_MZONE, zoneKey } from "./constants";
import { armBattleDestroy, attackImpactAt } from "./battle-hold";
import { collectFreshEvents, emitDuelFxCue, maxEventId } from "./event-queue";
import { PIECE_TINTS, groupScenes, planScene, tintForCode, type SceneCue, type SceneGroup } from "./fx3d/scene-plan";
import { pickBattleRoute } from "./fx3d/routing";
import { getSharedFx3d, viewportToHost } from "./fx3d/shared";
import type { FxRect, FxScene } from "./fx3d/types";
import { safeAnimate } from "./safe-animate";
import { chainEffectAt } from "./chain-beats";
import { holdPromptReveal } from "./prompt-reveal";

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
const DOM_FLASH_HOLD_MS = 700;
type Planned = {
  key: string;
  three: boolean;
  startAt: number;
  scene: FxScene;
  cues: SceneCue[];
  seed: number;
  /** DOM boxes for the fallback flash. */
  flash: Box[];
  started: boolean;
};

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

function planGroup(group: SceneGroup<DuelEvent>, events: readonly DuelEvent[], mySeat: number, now: number, three: boolean): Planned | null {
  const host = getSharedFx3d()?.host.getBoundingClientRect();
  const toRect = (box: Box): FxRect => (host ? viewportToHost(box, host) : { x: box.left, y: box.top, w: box.width, h: box.height });
  const victims: Array<{ rect: FxRect; code: number; defense: boolean; turned: boolean; box: Box; event: DuelEvent }> = [];
  for (const event of group.events) {
    if (!event.zone) continue;
    const found = artBox(zoneKey(event.zone.controller, event.zone.location, event.zone.sequence));
    if (!found) continue;
    victims.push({
      rect: toRect(found.box),
      code: event.card && event.card.code > 0 ? event.card.code : codeOfNode(found.node),
      defense: found.node.getAttribute("data-defense") === "true",
      turned: found.node.closest('[data-side="opp"]') != null,
      box: found.box,
      event,
    });
  }
  if (victims.length === 0) return null;
  const firstZone = victims[0].event.zone as { controller: number };
  const owner = group.sourceSeat >= 0 ? group.sourceSeat : 1 - firstZone.controller;
  const ownerSide = owner === mySeat ? "you" : "opp";
  const source = sourceBox(group.sourceCode, owner);
  const attackEvent = [...events].reverse().find((event) => event.kind === "attack" && event.zone && event.id < group.events[0].id);
  const attackerFound = group.piece === "mirror-force" || group.piece === "sakuretsu" || group.piece === "trap-hole"
    ? attackEvent?.zone ? artBox(zoneKey(attackEvent.zone.controller, attackEvent.zone.location, attackEvent.zone.sequence)) : null
    : null;
  const rows: Box[] = [];
  const rowSeats = group.piece === "mirror-force" ? [owner] : Array.from(new Set(victims.map((v) => (v.event.zone as { controller: number }).controller)));
  for (const seat of rowSeats) {
    const row = monsterRow(seat);
    if (row) rows.push(row);
  }
  const field = union(rows) ?? union(victims.map((v) => v.box)) ?? victims[0].box;
  // A destroy that is the effect of a resolving chain link starts while its badge is lit, never before.
  const startAt = Math.max(now, ...group.events.map((event) => chainEffectAt(event.id)));
  const attackImpact = attackEvent ? attackImpactAt(attackEvent.id) : 0;
  const { scene, cues } = planScene({
    piece: group.piece,
    victims: victims.map(({ rect, code, defense, turned }) => ({ rect, code, defense, turned })),
    source: source ? toRect(source) : null,
    attacker: attackerFound ? toRect(attackerFound.box) : null,
    field: toRect(field),
    ownerSide,
    tint: group.piece === "monster" ? tintForCode(group.sourceCode) : PIECE_TINTS[group.piece],
    attackImpactMs: attackImpact > startAt ? attackImpact - startAt : null,
  });
  if (three) {
    // The victims stay on their zones until their shards break: SummonFx keeps the ghosts, MoveFx waits.
    scene.victims.forEach((victim, index) => {
      const event = victims[index].event;
      if (event.zone) armBattleDestroy(`scene:${group.key}:${event.id}`, event.zone, victim.atMs, startAt, true);
    });
  }
  return {
    key: `${group.key}:${group.events[0].id}`,
    three,
    startAt,
    scene,
    cues,
    seed: (group.events[0].id * 2654435761) >>> 0,
    flash: victims.map((v) => v.box),
    started: false,
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
      pointerEvents: "none", zIndex: "60", borderRadius: "6px", background: `rgba(${tint},0.55)`, opacity: "0",
    });
    document.body.appendChild(el);
    nodes.push(el);
    {
      const flash = safeAnimate(el, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 300, easing: "ease-out", fill: "forwards" });
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
      const now = performance.now();
      const three = pickBattleRoute({ reduced: reducedMotion, ready: getSharedFx3d() != null }) === "three";
      for (const group of groups) {
        const key = `${group.key}:${group.events[0].id}`;
        if (plannedRef.current.has(key)) continue;
        const planned = planGroup(group, fresh, mySeat, now, three);
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
      const wait = Math.max(0, planned.startAt - performance.now());
      const shared = planned.three ? getSharedFx3d() : null;
      // The prompt waits for what actually plays: the whole piece on the canvas, or (DOM) the flash
      // plus, when holds were armed for the canvas, the held cards breaking on their zones.
      const lastBreak = planned.three ? planned.scene.victims.reduce((max, v) => Math.max(max, v.atMs), 0) : 0;
      const playMs = shared ? planned.scene.totalMs : Math.max(DOM_FLASH_HOLD_MS, lastBreak + DOM_FLASH_HOLD_MS);
      holdPromptReveal(Math.max(0, wait + playMs - Math.max(0, performance.now() - planned.startAt)));
      const begin = () => {
        const late = Math.max(0, performance.now() - planned.startAt);
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
            const timer = window.setTimeout(() => {
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
          const timer = window.setTimeout(() => {
            timersRef.current.delete(timer);
            undo();
            cleanupsRef.current.delete(undo);
          }, 400);
          timersRef.current.add(timer);
        }
      };
      if (wait > 0) {
        const starter = window.setTimeout(() => {
          timersRef.current.delete(starter);
          begin();
        }, wait);
        timersRef.current.add(starter);
      } else {
        begin();
      }
      const plannedKey = planned.key;
      const forget = window.setTimeout(() => {
        timersRef.current.delete(forget);
        plannedRef.current.delete(plannedKey);
      }, wait + planned.scene.totalMs + 500);
      timersRef.current.add(forget);
    }
  }, [events, active, reducedMotion]);

  useEffect(() => {
    const controllers = controllersRef.current;
    const timers = timersRef.current;
    const cleanups = cleanupsRef.current;
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      for (const undo of cleanups) undo();
      cleanups.clear();
    };
  }, []);

  return null;
}
