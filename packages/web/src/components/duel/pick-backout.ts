/**
 * Backing out of a one-card-at-a-time pick (Synchro / Xyz / Link / Fusion materials, discards).
 *
 * The engine only allows Cancel while nothing is selected yet (and only when the summon may be cancelled).
 * After the first pick Cancel is gone; the way back is to unselect, which the engine offers as "unselect"
 * options (selected: true). Pure rules for right-click, Esc and the bar button, so every answer sent is one
 * the engine offers: no illegal Cancel, no unselect of a card that cannot be unselected.
 */
import type { DuelAnswer, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { zoneKey } from "./constants";

function optionKey(option: DuelPromptOption): string | null {
  if (option.controller == null || option.location == null || option.sequence == null) return null;
  return zoneKey(option.controller, option.location, option.sequence);
}

/** The cards picked so far that the engine lets you unselect. */
function unselectable(prompt: DuelPrompt): DuelPromptOption[] {
  return prompt.options.filter((option) => option.selected);
}

/**
 * What right-click / Esc does for a toggle prompt. `zoneKeys` are the board zones under the pointer
 * (empty for Esc and for a click off the cards).
 *   a picked card under the pointer: unselect that card
 *   else cancel allowed (nothing picked yet): cancel the whole pick, back to the idle command prompt
 *   else something picked: unselect the last picked card (one step back)
 *   else null: a forced pick with nothing picked, nothing to do
 */
export function backOutAnswer(prompt: DuelPrompt | null | undefined, zoneKeys: readonly string[] = []): DuelAnswer | null {
  if (!prompt || prompt.kind !== "toggle") return null;
  const picked = unselectable(prompt);
  if (zoneKeys.length > 0) {
    const under = picked.find((option) => {
      const key = optionKey(option);
      return key != null && zoneKeys.includes(key);
    });
    if (under) return { choice: under.id };
  }
  if (prompt.cancelable) return { cancel: true };
  const last = picked[picked.length - 1];
  return last ? { choice: last.id } : null;
}

/** Label of the visible back-out button on the select bar; null when there is nothing to back out of. */
export function backOutLabel(prompt: DuelPrompt | null | undefined): "Cancel" | "Undo" | null {
  const answer = backOutAnswer(prompt);
  if (!answer) return null;
  return answer.cancel ? "Cancel" : "Undo";
}
