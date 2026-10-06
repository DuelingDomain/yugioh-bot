import type { DuelEvent } from "@yugidraft/shared/duels";

/**
 * Who a declared attack hits, read the same way on every seat (BattleFx draws it for the target,
 * the bystanders and the spectators alike, not only for the attacker who picked it).
 *
 * A monster target names its controller. A direct attack names its defender in `targetSeat` (the
 * engine sends it to every seat, but not in a 2-seat duel). Only a 2-seat duel may guess it: there
 * the defender is the other seat. `seatCount` is the number of seats of the duel (the engine view's
 * seats), not a count of what the page has drawn. With 3 or 4 seats, or when the seats are not
 * known, a missing `targetSeat` is unknown, never `1 - controller` (that is a wrong seat, or -1,
 * which has no LP plate and so no arrow at all).
 */
export function directTargetSeat(attack: DuelEvent, seatCount: number): number | null {
  if (attack.targetSeat != null) return attack.targetSeat;
  const controller = attack.zone?.controller;
  return seatCount === 2 && (controller === 0 || controller === 1) ? 1 - controller : null;
}

/** The player an attack is aimed at, or null when it is not known. */
export function attackedSeat(attack: DuelEvent, seatCount: number): number | null {
  return attack.target ? attack.target.controller : directTargetSeat(attack, seatCount);
}

/** The line every seat reads while the attack is declared: who attacks whom. */
export function declaredCaption(attack: DuelEvent, seatCount: number, nameOf: (seat: number) => string): string | null {
  const from = attack.seat ?? attack.zone?.controller;
  const to = attackedSeat(attack, seatCount);
  if (from == null || to == null) return null;
  return attack.target ? `${nameOf(from)} attacks ${nameOf(to)}` : `${nameOf(from)}: direct attack on ${nameOf(to)}`;
}

type Spot = { x: number; y: number };
type Area = { left: number; top: number; width: number; height: number };

/** About how big the caption is on screen (13px text, 10px side padding, at most 360px wide). */
export function captionSize(text: string): { width: number; height: number } {
  return { width: Math.min(360, Math.round(text.length * 7.4) + 22), height: 30 };
}

function overlap(a: Area, b: Area): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where the caption sits: on the middle of the arrow when that is free, else the nearest spot beside or along
 * it that covers the fewest `obstacles` (zones and plates), so a short arrow between facing seats does not put
 * the line over the cards. A spot is kept on the screen (`view`). Pure: the same inputs give the same spot.
 */
export function placeCaption(start: Spot, tip: Spot, size: { width: number; height: number }, obstacles: readonly Area[], view: { width: number; height: number }): Spot {
  const dx = tip.x - start.x;
  const dy = tip.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  // How far to step off the arrow so the whole caption clears its line: its half extent along the normal, plus a margin.
  const side = Math.abs(nx) * size.width / 2 + Math.abs(ny) * size.height / 2 + 12;
  // Preference order: the middle, beside it, then along the arrow (with and without the side step).
  const spots: Array<[number, number]> = [[0.5, 0], [0.5, 1], [0.5, -1], [0.34, 0], [0.66, 0], [0.34, 1], [0.66, 1], [0.34, -1], [0.66, -1], [0.5, 2], [0.5, -2]];
  let best: Spot | null = null;
  let bestCost = Infinity;
  for (const [t, step] of spots) {
    const clamp = (v: number, half: number, max: number) => (max > 2 * half ? Math.min(Math.max(v, half), max - half) : v);
    const spot = {
      x: clamp(start.x + dx * t + nx * side * step, size.width / 2, view.width),
      y: clamp(start.y + dy * t + ny * side * step, size.height / 2, view.height),
    };
    const box = { left: spot.x - size.width / 2, top: spot.y - size.height / 2, width: size.width, height: size.height };
    const cost = obstacles.reduce((sum, area) => sum + overlap(box, area), 0);
    if (cost < bestCost) {
      best = spot;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best ?? { x: (start.x + tip.x) / 2, y: (start.y + tip.y) / 2 };
}
