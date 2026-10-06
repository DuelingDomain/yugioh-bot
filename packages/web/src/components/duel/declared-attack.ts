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
