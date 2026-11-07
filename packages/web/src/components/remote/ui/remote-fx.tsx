"use client";

import { useLayoutEffect, useRef } from "react";
import type { RemoteEvent, RemoteState } from "@yugidraft/shared/remote";
import { safeAnimate } from "@/components/duel/safe-animate";
import { cardInfo } from "./catalog";
import s from "./remote-ui.module.css";

/**
 * Duel effects for the virtual board. The remote table has no engine events, so the effects come from what the
 * state shows: an attack that was declared, a card that left the field for the Graveyard, a card that entered a
 * Monster Zone, a card that was activated, a life point change. The layer never takes a click and never hides the
 * board for long. Webcam-only view keeps only the life point change (there is no board to draw on).
 */

type Box = { x: number; y: number; w: number; h: number };
type Seen = { seat: number; zone: string; faceUp: boolean; cardId?: number };
type Snap = { game: string; seq: number; undo: boolean; attackId: string | null; lp: number[]; cards: Map<string, Seen>; contexts: Set<string> };

const ON_FIELD = new Set(["monster", "extra-monster", "spell-trap", "field", "pendulum"]);
const IN_MONSTER = new Set(["monster", "extra-monster"]);
const MAX_PER_STATE = 6;

const ATTRIBUTE_TINT: Record<string, string> = {
  DARK: "168 120 255", LIGHT: "244 226 180", FIRE: "255 130 70", WATER: "90 170 255", WIND: "120 230 160", EARTH: "200 150 90", DIVINE: "255 215 110",
};
const SUMMON_TINT: Record<string, string> = {
  fusion: "198 168 255", synchro: "240 244 255", xyz: "244 214 144", link: "120 190 255", ritual: "150 200 255", pendulum: "120 230 220",
};
const GOLD = "244 226 180";
const LOSS = "228 90 77";

const snapOf = (state: RemoteState, seq: number, undo: boolean): Snap => {
  const cards = new Map<string, Seen>();
  for (const seat of state.seats) for (const card of seat.twin) cards.set(card.ref, { seat: seat.seat, zone: card.zone, faceUp: card.faceUp !== false, cardId: card.cardId ?? card.passcode });
  return {
    game: `${state.gameId}:${state.match?.games?.length ?? 0}`, seq, undo, attackId: state.attack?.id ?? null, lp: state.seats.map(seat => seat.resources.lp ?? 0), cards,
    contexts: new Set(Object.keys(state.effectTracking?.contexts ?? {})),
  };
};

const boxOf = (el: Element | null): Box | null => {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  // A card that is scrolled out of sight gets no effect.
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null;
  return rect.width > 2 && rect.height > 2 ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : null;
};
const cardEl = (ref: string) => document.querySelector(`[data-zone][data-ref="${CSS.escape(ref)}"], [data-ref="${CSS.escape(ref)}"]`);
const centre = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

function tintOfCard(cardId: number | undefined, fallback: string): string {
  const info = cardInfo(cardId);
  if (!info) return fallback;
  const frame = `${info.frameType ?? ""} ${info.type ?? ""}`.toLowerCase();
  for (const key of Object.keys(SUMMON_TINT)) if (frame.includes(key)) return SUMMON_TINT[key];
  return fallback;
}

/**
 * `seq` is the table's newest event number; `last` is the action of that event. Effects play only when exactly one
 * new event arrived since the last render: not on first load, not after a reconnect that brings many events, and not for an
 * Undo (the server marks it as an `undo` event, so every seat sees the same).
 */
export function RemoteFx({ state, webcamOnly, seq, last }: { state: RemoteState; webcamOnly: boolean; seq: number; last?: RemoteEvent["action"] }) {
  const lastType = last?.type;
  const layer = useRef<HTMLDivElement>(null);
  const prev = useRef<Snap | null>(null);
  const rects = useRef(new Map<string, Box>());

  useLayoutEffect(() => {
    const host = layer.current; if (!host) return;
    const next = snapOf(state, seq, lastType === "undo");
    const before = prev.current;
    prev.current = next;
    const reduced = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
    let used = 0;

    const mount = (css: Partial<CSSStyleDeclaration>): HTMLDivElement => {
      const node = document.createElement("div");
      Object.assign(node.style, { position: "absolute", pointerEvents: "none", left: "0", top: "0" }, css);
      host.appendChild(node);
      return node;
    };
    const play = (node: HTMLElement, frames: Keyframe[], duration: number, delay = 0) => {
      const animation = safeAnimate(node, frames, { duration: reduced ? Math.min(duration, 450) : duration, delay, easing: "ease-out", fill: "both" });
      const remove = () => node.remove();
      if (animation) { animation.onfinish = remove; animation.oncancel = remove; } else remove();
    };
    const glow = (box: Box, tint: string, strength = 1) => {
      const node = mount({ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, borderRadius: "8px", background: `radial-gradient(closest-side, rgb(${tint} / .55), rgb(${tint} / 0))`, boxShadow: `0 0 ${24 * strength}px rgb(${tint} / .85), inset 0 0 ${16 * strength}px rgb(${tint} / .7)`, mixBlendMode: "screen" });
      play(node, [{ opacity: 0, transform: "scale(.9)" }, { opacity: 1, transform: "scale(1.04)", offset: .35 }, { opacity: 0, transform: reduced ? "scale(1)" : "scale(1.25)" }], 620);
    };
    const ring = (box: Box, tint: string, delay = 0) => {
      const c = centre(box); const size = Math.max(box.w, box.h) * 1.1;
      const node = mount({ left: `${c.x - size / 2}px`, top: `${c.y - size / 2}px`, width: `${size}px`, height: `${size}px`, borderRadius: "50%", border: `2px solid rgb(${tint} / .95)`, boxShadow: `0 0 18px rgb(${tint} / .8)` });
      play(node, [{ opacity: .95, transform: "scale(.35)" }, { opacity: 0, transform: reduced ? "scale(.6)" : "scale(1.7)" }], 520, delay);
    };
    const shatter = (box: Box) => {
      const flash = mount({ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, borderRadius: "6px", background: `rgb(${LOSS} / .65)`, boxShadow: `0 0 20px rgb(${LOSS} / .9)`, mixBlendMode: "screen" });
      play(flash, [{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 0 }], 460);
      if (reduced) return;
      for (let i = 0; i < 7; i += 1) {
        const angle = (i / 7) * Math.PI * 2 + i; const dist = Math.max(box.w, box.h) * (.55 + (i % 3) * .2);
        const bit = mount({ left: `${box.x + box.w / 2 - 6}px`, top: `${box.y + box.h / 2 - 6}px`, width: "12px", height: "12px", background: `rgb(${LOSS} / .9)`, clipPath: "polygon(50% 0, 100% 100%, 0 80%)" });
        play(bit, [{ opacity: 1, transform: "translate(0,0) rotate(0) scale(1)" }, { opacity: 0, transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 18}px) rotate(${i * 80}deg) scale(.4)` }], 620, 120);
      }
    };
    const strike = (from: Box, to: Box, tint: string) => {
      const a = centre(from); const b = centre(to);
      const length = Math.hypot(b.x - a.x, b.y - a.y); const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (!reduced) {
        const line = mount({ left: `${a.x}px`, top: `${a.y - 3}px`, width: `${length}px`, height: "6px", transformOrigin: "0 50%", borderRadius: "3px", background: `linear-gradient(90deg, rgb(${tint} / 0), rgb(${tint} / .95) 70%, #fff)`, boxShadow: `0 0 14px rgb(${tint} / .9)` });
        line.style.rotate = `${angle}rad`;
        play(line, [{ opacity: 0, transform: "scaleX(.05)" }, { opacity: 1, transform: "scaleX(1)", offset: .55 }, { opacity: 0, transform: "scaleX(1)" }], 520);
      }
      glow(from, tint, .7);
      glow(to, tint, 1.4); ring(to, tint, reduced ? 0 : 300);
    };

    const lpFlash = (seat: number, delta: number) => {
      const el = document.querySelector(`[data-lp-seat="${seat}"]`); const box = boxOf(el); if (!box) return;
      const tint = delta < 0 ? LOSS : GOLD;
      glow({ x: box.x - 8, y: box.y - 4, w: box.w + 16, h: box.h + 8 }, tint, .8);
      if (reduced) return;
      const text = mount({ left: `${box.x + box.w / 2}px`, top: `${box.y}px`, font: "700 26px/1 var(--font-duel-display), Oxanium, sans-serif", color: `rgb(${tint})`, textShadow: `0 0 12px rgb(${tint} / .8), 0 2px 0 rgb(0 0 0 / .6)`, whiteSpace: "nowrap" });
      text.textContent = `${delta < 0 ? "−" : "+"}${Math.abs(delta)}`;
      play(text, [{ opacity: 0, transform: "translate(-50%, 6px)" }, { opacity: 1, transform: "translate(-50%, -8px)", offset: .2 }, { opacity: 0, transform: "translate(-50%, -44px)" }], 1200);
    };

    // An Undo puts cards back where they were: that is not a summon, a destroy or an attack, so it plays nothing.
    if (before && before.game === next.game && next.seq - before.seq === 1 && !next.undo && !document.hidden) {
      next.lp.forEach((value, seat) => {
        const old = before.lp[seat];
        if (old !== undefined && old !== value && used < MAX_PER_STATE) { used += 1; lpFlash(seat, value - old); }
      });

      if (!webcamOnly) {
        const attack = state.attack;
        if (attack && attack.id !== before.attackId) {
          const from = (attack.attackerCardRef && (boxOf(cardEl(attack.attackerCardRef)) ?? rects.current.get(attack.attackerCardRef))) || null;
          const to = (attack.targetCardRef && (boxOf(cardEl(attack.targetCardRef)) ?? rects.current.get(attack.targetCardRef)))
            || boxOf(document.querySelector(`[data-plate="${attack.targetSeat}"]`)) || boxOf(document.querySelector(`[data-lp-seat="${attack.targetSeat}"]`));
          const attacker = attack.attackerCardRef ? next.cards.get(attack.attackerCardRef) : undefined;
          const info = cardInfo(attacker?.cardId);
          const tint = ATTRIBUTE_TINT[String(info?.attribute ?? "").toUpperCase()] ?? "255 170 90";
          if (from && to && used < MAX_PER_STATE) { used += 1; strike(from, to, tint); }
          else if (to && used < MAX_PER_STATE) { used += 1; glow(to, tint, 1.4); ring(to, tint); }
        }

        const materialMove = (last?.type === "twin.place" && !!last.summon) || last?.type === "twin.attach";
        for (const [ref, now] of next.cards) {
          if (used >= MAX_PER_STATE) break;
          const old = before.cards.get(ref);
          if (old && ON_FIELD.has(old.zone) && now.zone === "graveyard") {
            // A summon material is not destroyed. Only a battle destroy shatters; any other send to the Graveyard is a soft flash.
            if (materialMove) continue;
            const box = rects.current.get(ref);
            if (box) { used += 1; if (lastType === "attack.resolve") shatter(box); else glow(box, LOSS, .6); }
          } else if (IN_MONSTER.has(now.zone) && (!old || !IN_MONSTER.has(old.zone)) && now.faceUp) {
            const box = boxOf(cardEl(ref));
            if (box) { used += 1; const tint = tintOfCard(now.cardId, GOLD); glow(box, tint, 1.2); ring(box, tint); ring(box, tint, 140); }
          } else if (old && now.zone === "spell-trap" && !old.faceUp && now.faceUp) {
            const box = boxOf(cardEl(ref));
            if (box) { used += 1; glow(box, "155 126 255", 1.3); ring(box, "155 126 255"); }
          }
        }

        // The activation FX come from the newest activation, so every activation plays one, not only a Set from Deck.
        let activated = false;
        if (last?.type === "effect.activated" && used < MAX_PER_STATE) {
          const source = last.source;
          const ref = source.cardRef ?? state.seats[last.actorSeat]?.twin.find(card => ON_FIELD.has(card.zone) && source.cardId !== undefined && (card.cardId ?? card.passcode) === source.cardId)?.ref;
          const box = ref ? boxOf(cardEl(ref)) ?? rects.current.get(ref) : null;
          if (box) { used += 1; activated = true; glow(box, "155 126 255", 1.3); ring(box, "155 126 255"); }
        }
        for (const id of activated ? [] : next.contexts) {
          if (used >= MAX_PER_STATE || before.contexts.has(id)) continue;
          const ref = state.effectTracking?.contexts[Number(id)]?.source.cardRef;
          const box = ref ? boxOf(cardEl(ref)) ?? rects.current.get(ref) : null;
          if (box) { used += 1; glow(box, "155 126 255", 1.3); ring(box, "155 126 255"); }
        }
      }
    }

    // Remember where every card is, so a card that just left the field can still burst where it stood.
    rects.current.clear();
    document.querySelectorAll<HTMLElement>("[data-zone] [data-ref], [data-zone][data-ref]").forEach(el => {
      const ref = el.getAttribute("data-ref"); const box = boxOf(el); if (ref && box) rects.current.set(ref, box);
    });
  }, [state, webcamOnly, seq, last]);

  return <div ref={layer} className={s.fxl} aria-hidden="true" data-testid="remote-fx" />;
}
