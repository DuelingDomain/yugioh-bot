import type { DuelEvent } from "@yugidraft/shared/duels";

/**
 * Who a declared attack hits, read the same way on every seat (BattleFx draws it for the target,
 * the bystanders and the spectators alike, not only for the attacker who picked it).
 *
 * A monster target names its controller. A direct attack names its defender in `targetSeat` (the
 * engine sends it to every seat). Only a 2-seat duel may guess it: there the defender is the other
 * seat. With 3 or 4 seats a missing `targetSeat` is unknown, never `1 - controller` (that is a
 * wrong seat, or -1, which has no LP plate and so no arrow at all).
 */
export function directTargetSeat(attack: DuelEvent, lpSeats: readonly number[]): number | null {
  if (attack.targetSeat != null) return attack.targetSeat;
  const controller = attack.zone?.controller;
  if (controller == null || lpSeats.length !== 2 || !lpSeats.includes(controller)) return null;
  return lpSeats.find((seat) => seat !== controller) ?? null;
}

/** The player an attack is aimed at, or null when it is not known. */
export function attackedSeat(attack: DuelEvent, lpSeats: readonly number[]): number | null {
  return attack.target ? attack.target.controller : directTargetSeat(attack, lpSeats);
}

/** The line every seat reads while the attack is declared: who attacks whom. */
export function declaredCaption(attack: DuelEvent, lpSeats: readonly number[], nameOf: (seat: number) => string): string | null {
  const from = attack.seat ?? attack.zone?.controller;
  const to = attackedSeat(attack, lpSeats);
  if (from == null || to == null) return null;
  return attack.target ? `${nameOf(from)} attacks ${nameOf(to)}` : `${nameOf(from)}: direct attack on ${nameOf(to)}`;
}
