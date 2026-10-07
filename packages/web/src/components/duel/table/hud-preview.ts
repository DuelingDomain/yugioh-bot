import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";

type Owner = { name: string; main: string; ink: string };

export type HudPreview = { card: DuelCard | DuelCardInfo; owner: Owner | null };

/**
 * What the HUD's left hover preview shows. A hovered or focused board card wins (a different card switches the panel).
 * With none under the pointer, an open card action menu keeps its own card in the panel, so the panel stays while the
 * pointer moves from the card to the menu and over its options (and on touch, where a tap opens the menu with no hover).
 * Then the card of a prompt row; with none of them the panel closes.
 */
export function hudPreview(
  hover: DuelCard | null,
  menuCard: DuelCard | null | undefined,
  rowCard: DuelCardInfo | null,
  ownerOf: (card: DuelCard) => Owner,
): HudPreview | null {
  // A menu card without a code has no art to show, as on the hover path.
  const menuBoard = menuCard && menuCard.code != null ? menuCard : null;
  const board = hover ?? menuBoard;
  if (board) return { card: board, owner: ownerOf(board) };
  return rowCard ? { card: rowCard, owner: null } : null;
}
