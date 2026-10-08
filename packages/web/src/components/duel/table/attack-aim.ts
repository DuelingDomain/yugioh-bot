import type { DuelAnswer, DuelEngineView, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { zoneKey } from "../constants";
import { engineFormat, foeSeats, isEliminated } from "../multi-seat";
import { isAttackDuelistPrompt, isAttackTargetPrompt, isDirectAttackPrompt, optionZoneKeys } from "../prompts";

/**
 * The aim that comes before an attack is sent on a table of 3, 4 or Tag. The core may skip its own target step
 * (one living rival that can be hit directly is not asked), so the table never leaves the aim to the core: a click on
 * an attack only picks the attacker. The player then aims with the arrow and clicks the target, and only then is the
 * attack sent. The target is remembered and answers the core's own target step, if it asks one.
 */

/** What the player clicked: a monster (its zone key) or a rival seat (a direct attack). */
export type AttackAimTarget = { zoneKey: string } | { seat: number };

export interface AttackAim {
  /** Zone key of the attacker. */
  key: string;
  /** The attack option that is sent once a target is clicked. */
  optionId: string;
  /** The attacker may hit a rival directly (its option says so). */
  direct: boolean;
  /** Send the attack and remember the target. */
  send: (target: AttackAimTarget) => void;
  cancel: () => void;
}

/** The attack option of an action prompt that waits for an aim. Null when the answer is not a declared attack. */
export function attackAimOf(prompt: DuelPrompt | null, answer: DuelAnswer): { key: string; optionId: string; direct: boolean } | null {
  if (prompt?.context?.type !== "action" || !answer.choice?.startsWith("attack:")) return null;
  const option = prompt.options.find((entry) => entry.id === answer.choice);
  if (!option || option.controller == null || option.location == null || option.sequence == null) return null;
  return { key: zoneKey(option.controller, option.location, option.sequence), optionId: option.id, direct: /directly/i.test(option.label) };
}

/**
 * The target step as the table sees it before the core asks: every monster of a rival, and (when the attacker may
 * hit directly) every living rival with an empty monster zone row. It has the shape of the core's n-seat attack
 * pick, so the aim code treats both alike.
 */
export function aimPromptFor(
  real: DuelPrompt,
  engine: Pick<DuelEngineView, "seats" | "format">,
  viewerSeat: number | null,
  direct: boolean,
): DuelPrompt {
  const options: DuelPromptOption[] = [];
  const foes = new Set(foeSeats(engineFormat(engine), viewerSeat));
  let index = 0;
  for (const view of engine.seats) {
    if (!foes.has(view.seat) || isEliminated(view)) continue;
    const monsters = view.monsters.filter((card) => card != null);
    for (const card of monsters) {
      options.push({
        id: `card:${index++}`,
        label: card.name?.trim() || "face-down monster",
        controller: card.controller,
        location: card.location,
        sequence: card.sequence,
      });
    }
    if (direct && monsters.length === 0) {
      options.push({ id: `direct:${view.seat}`, label: `Attack Player ${view.seat + 1} directly`, controller: view.seat });
    }
  }
  return { id: `${real.id}:aim`, seat: real.seat, kind: "choice", title: "Select an attack target", options };
}

/** The target that a synthetic option stands for. */
export function aimTargetOf(option: DuelPromptOption): AttackAimTarget | null {
  const [key] = optionZoneKeys(option);
  if (key) return { zoneKey: key };
  return option.controller != null && option.location == null ? { seat: option.controller } : null;
}

/** True for the prompts of the core's own attack steps. */
export function isAttackStepPrompt(prompt: DuelPrompt | null): boolean {
  return isAttackTargetPrompt(prompt, true) || isAttackDuelistPrompt(prompt) || isDirectAttackPrompt(prompt);
}

/**
 * The answer that the remembered target gives to a step of the core, or null when the step does not offer that
 * target (then the player aims again on the real prompt). "Attack directly?" is yes for a seat and no for a monster.
 */
export function queuedAnswer(prompt: DuelPrompt, target: AttackAimTarget): DuelAnswer | null {
  if (isDirectAttackPrompt(prompt)) {
    const id = "seat" in target ? "yes" : "no";
    return prompt.options.some((option) => option.id === id) ? { choice: id } : null;
  }
  const match = prompt.options.find((option) => {
    if ("zoneKey" in target) return optionZoneKeys(option)[0] === target.zoneKey;
    return option.controller === target.seat && option.location == null;
  });
  if (!match) return null;
  return prompt.kind === "choice" ? { choice: match.id } : { selected: [match.id] };
}
