import type { DuelPrompt } from "@yugidraft/shared/duels";
import { centerKind, isBoardTogglePrompt } from "./prompt-center";

/**
 * A pick that is answered with a click on the field: a zone, a tribute, a card on the board, one material at a
 * time. Its legal zones glow on the field from the first frame, so they must take a click from the first frame too.
 */
export function answersOnField(prompt: DuelPrompt | null | undefined): boolean {
  if (!prompt) return false;
  return centerKind(prompt) === "select" || isBoardTogglePrompt(prompt);
}

/**
 * True while a centred prompt waits its reveal beat (prompt-reveal.ts) and the field must not answer it: a panel
 * prompt (yes/no, a chain response, a card grid) is not on screen yet. A field pick is never held back: the click
 * on a glowing zone during the chain intro is the answer (owner: "I click, then I have to wait, then click again").
 */
export function fieldWaitsForReveal(prompt: DuelPrompt | null | undefined, revealed: boolean): boolean {
  if (revealed || !prompt) return false;
  return centerKind(prompt) != null && !answersOnField(prompt);
}
