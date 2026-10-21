import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";

type Owner = { name: string; main: string; ink: string };

export type HudPreview = { card: DuelCard | DuelCardInfo; owner: Owner | null; pinned?: true; /** Shown for an open card action menu, so the player reads the card they are acting on: "Off" keeps it. */ held?: true };

/**
 * What the HUD's left hover preview shows. A hovered or focused board card wins (a different card switches the panel).
 * With none under the pointer, an open card action menu keeps its own card in the panel, so the panel stays while the
 * pointer moves from the card to the menu and over its options (and on touch, where a tap opens the menu with no hover).
 * Then the card of a prompt row; with none of them the panel closes.
 * A pinned card (a click on a board card) stays when the pointer leaves, but it does not hold the panel: hovering ANOTHER face-up board card
 * switches the panel to that card (the shell then pins it too, see `usePinFollowsHover`). Face-down hovers and a menu card do not take it over.
 * Only a prompt row under the pointer shows its own card over the pin (the pin returns when the pointer leaves the row).
 */
export function hudPreview(
  hover: DuelCard | null,
  menuCard: DuelCard | null | undefined,
  rowCard: DuelCardInfo | DuelCard | null,
  ownerOf: (card: DuelCard) => Owner,
  pinned: DuelCard | DuelCardInfo | null = null,
): HudPreview | null {
  if (rowCard && pinned && pinned.code != null) return { card: rowCard, owner: null };
  // The card of an Inspect on a prompt row or a log row has no seat: no owner line.
  if (pinned && pinned.code != null && hover && hover.code != null) return { card: hover, owner: ownerOf(hover), pinned: true };
  if (pinned && pinned.code != null) return { card: pinned, owner: "location" in pinned ? ownerOf(pinned) : null, pinned: true };
  // A menu card without a code has no art to show, as on the hover path.
  const menuBoard = menuCard && menuCard.code != null ? menuCard : null;
  const board = hover ?? menuBoard;
  if (board) {
    const held = menuBoard != null && (hover == null || (hover.code === menuBoard.code && hover.controller === menuBoard.controller
      && hover.location === menuBoard.location && hover.sequence === menuBoard.sequence));
    return held ? { card: board, owner: ownerOf(board), held: true } : { card: board, owner: ownerOf(board) };
  }
  return rowCard ? { card: rowCard, owner: null } : null;
}
