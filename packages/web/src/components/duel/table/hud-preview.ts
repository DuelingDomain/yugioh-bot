import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";

type Owner = { name: string; main: string; ink: string };

export type HudPreview = { card: DuelCard | DuelCardInfo; owner: Owner | null; pinned?: true };

/**
 * What the HUD's left hover preview shows. A hovered or focused board card wins (a different card switches the panel).
 * With none under the pointer, an open card action menu keeps its own card in the panel, so the panel stays while the
 * pointer moves from the card to the menu and over its options (and on touch, where a tap opens the menu with no hover).
 * Then the card of a prompt row; with none of them the panel closes.
 * A pinned card (a click on a board card) beats a board hover and a menu card: the panel stays on it, and a hover cannot swap it or open a
 * second panel. Only a prompt row under the pointer shows its own card over the pin (the pin returns when the pointer leaves the row).
 */
export function hudPreview(
  hover: DuelCard | null,
  menuCard: DuelCard | null | undefined,
  rowCard: DuelCardInfo | null,
  ownerOf: (card: DuelCard) => Owner,
  pinned: DuelCard | null = null,
): HudPreview | null {
  if (rowCard && pinned && pinned.code != null) return { card: rowCard, owner: null };
  if (pinned && pinned.code != null) return { card: pinned, owner: ownerOf(pinned), pinned: true };
  // A menu card without a code has no art to show, as on the hover path.
  const menuBoard = menuCard && menuCard.code != null ? menuCard : null;
  const board = hover ?? menuBoard;
  if (board) return { card: board, owner: ownerOf(board) };
  return rowCard ? { card: rowCard, owner: null } : null;
}
