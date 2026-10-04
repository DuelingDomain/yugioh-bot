/**
 * Picking Tributes on the field.
 *
 * The engine's tribute prompt counts in contribution, not cards: `min` is how much the Tributes must be
 * worth (the sum of each card's `values[0]`, a card that counts as two has 2) and `max` is the most cards
 * that may be released. The server accepts any pick of at most `max` cards worth at least `min`.
 *
 * The pick sends itself when it cannot change any more: it is worth enough and no other card may still
 * be added (the pick is full, or no card is left to add). When it is worth enough but another card could
 * still join (a card that counts as two, with room for one more), the player confirms with Summon.
 * Pure: no DOM, no React.
 */
import type { DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";

export type TributeState = {
  /** What the Tributes must be worth, at least. */
  need: number;
  /** What the picked cards are worth. */
  total: number;
  /** Cards picked. */
  count: number;
  /** Most cards that may be picked. */
  cap: number;
  /** The pick is worth enough. */
  met: boolean;
  /** Another card may still be added. */
  canAdd: boolean;
  /** The player picked at least one card (a forced pick alone does not send itself). */
  userPicked: boolean;
  /** Send now. */
  autoSend: boolean;
  /** Worth enough but still open: show Summon. */
  showSummon: boolean;
};

/** What one card is worth as a Tribute. The engine says; a card without a value counts as one. */
export function tributeValue(option: Pick<DuelPromptOption, "values"> | undefined): number {
  const value = option?.values?.[0];
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

export function tributeState(prompt: DuelPrompt, selected: readonly string[]): TributeState {
  const need = Math.max(0, prompt.min ?? 0);
  const cap = prompt.max ?? Math.max(prompt.options.length, need);
  const chosen = new Set(selected);
  let total = 0;
  for (const option of prompt.options) if (chosen.has(option.id)) total += tributeValue(option);
  const count = selected.length;
  const met = total >= need;
  const canAdd = count < cap && prompt.options.some((option) => !chosen.has(option.id));
  const userPicked = selected.some((id) => !prompt.mandatory?.includes(id));
  const autoSend = met && !canAdd && userPicked && count >= 1;
  return { need, total, count, cap, met, canAdd, userPicked, autoSend, showSummon: met && count >= 1 && !autoSend };
}

export type TributeClick = {
  /** The selection after the click (the same array when nothing changed). */
  next: string[];
  /** The pick is complete and unambiguous: send it. */
  send: boolean;
};

/**
 * What a click on a Tribute candidate does. A click on a picked card takes it back; a click on a card
 * when the pick is full (and the cap is above one) changes nothing; a one-card pick swaps to the clicked card.
 */
export function tributeClick(prompt: DuelPrompt, current: string[], optionId: string): TributeClick {
  if (current.includes(optionId)) {
    if (prompt.mandatory?.includes(optionId)) return { next: current, send: false };
    return { next: current.filter((id) => id !== optionId), send: false };
  }
  const cap = prompt.max ?? Math.max(prompt.options.length, prompt.min ?? 0);
  let next: string[];
  if (current.length >= cap) {
    if (cap === 1 && !prompt.mandatory?.length) next = [optionId];
    else return { next: current, send: false };
  } else {
    next = [...current, optionId];
  }
  return { next, send: tributeState(prompt, next).autoSend };
}
