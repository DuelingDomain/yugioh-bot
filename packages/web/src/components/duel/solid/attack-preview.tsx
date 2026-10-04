import type { ReactNode } from "react";
import type { DuelCard, DuelEngineView } from "@yugidraft/shared/duels";
import { isDefense, isFacedown, zoneKey } from "../constants";

export type AttackPreview = { attacker: string; target: string; lines: ReactNode[] };

function monsterAt(engine: DuelEngineView, key: string): DuelCard | null {
  for (const seat of engine.seats) {
    for (const card of seat.monsters) {
      if (card && zoneKey(card.controller, card.location, card.sequence) === key) return card;
    }
  }
  return null;
}

/**
 * 3D mode only: the numbers and the outcome lines shown in the attack confirm ("2500 vs 1700", "X is destroyed",
 * "Name takes 800"). Plain battle maths from the visible stats; effects that change the fight are not predicted.
 * Returns undefined when a side is unknown or face-down (the confirm then shows only its buttons).
 */
export function buildAttackPreview(engine: DuelEngineView, attackerKey: string | null, targetKey: string, nameOf: (seat: number) => string): AttackPreview | undefined {
  if (!attackerKey) return undefined;
  const attacker = monsterAt(engine, attackerKey);
  const target = monsterAt(engine, targetKey);
  if (!attacker || !target || attacker.attack == null || isFacedown(target.position)) return undefined;
  const atk = attacker.attack;
  const defending = isDefense(target.position);
  const against = (defending ? target.defense : target.attack) ?? 0;
  const lines: ReactNode[] = [];
  const foe = <b>{nameOf(target.controller)}</b>;
  const me = <b>{nameOf(attacker.controller)}</b>;
  if (atk > against) {
    lines.push(<><b>{target.name ?? "The target"}</b> is destroyed</>);
    if (!defending) lines.push(<>{foe} takes {atk - against}</>);
  } else if (atk < against) {
    if (!defending) lines.push(<><b>{attacker.name ?? "Your monster"}</b> is destroyed</>);
    lines.push(<>{me} takes {against - atk}</>);
  } else if (!defending) {
    lines.push(<>Both monsters are destroyed</>);
  } else {
    lines.push(<>No monster is destroyed</>);
  }
  return { attacker: String(atk), target: String(against), lines };
}
