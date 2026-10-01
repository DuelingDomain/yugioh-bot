import type { DuelPrompt } from "@yugidraft/shared/duels";

/** Prompt kinds that pick cards one by one on the board (materials, tributes, discards, targets). */
const CARD_PICK_KINDS: ReadonlySet<DuelPrompt["kind"]> = new Set(["cards", "tribute", "sum", "toggle"]);

/** Contexts that are an action menu, a chain response or a yes/no, not a pick. */
const NON_PICK_CONTEXTS: ReadonlySet<string> = new Set(["action", "chain", "position", "deck-master-recall"]);

/**
 * True when the prompt asks the player to pick cards on the board (Fusion / Synchro / Xyz / Link materials,
 * tributes, targets, discards). False for the action menu and chain responses: cards that can be used there are
 * not a pick, so a hand card keeps its plain mark.
 */
export function isCardPickPrompt(prompt: DuelPrompt | null): boolean {
  if (!prompt || prompt.options.length === 0) return false;
  if (!CARD_PICK_KINDS.has(prompt.kind)) return false;
  const context = prompt.context?.type;
  return context == null || !NON_PICK_CONTEXTS.has(context);
}

/**
 * How a legal or selected zone is drawn. A card on the board, in a pile or in the Deck Master dock glows.
 * An empty zone (a place to put a card) keeps its dashed outline. A hand card glows only while the player is
 * picking cards; otherwise it keeps its outline, as the usable-card glow is not for the hand.
 */
export function zoneMarkLook(zone: { occupied: boolean; hand: boolean; picking: boolean }): "glow" | "ring" {
  if (!zone.occupied) return "ring";
  if (zone.hand && !zone.picking) return "ring";
  return "glow";
}
