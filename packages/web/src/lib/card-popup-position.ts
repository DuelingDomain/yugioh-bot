/**
 * Where the card preview popover sits next to a card tile. The popover is a compact two-column panel (art left,
 * details right). Its width is fixed and its height grows with the card text up to a cap (`POPUP_HEIGHT`), after which
 * the text scrolls inside it. Placement uses the cap, so the panel stays inside the viewport at any text length.
 */
export const POPUP_WIDTH = 460;
/** The tallest the panel gets. The card text scrolls inside it beyond this. */
export const POPUP_HEIGHT = 360;
export const POPUP_MARGIN = 16;

export interface PopupPosition {
  left: number;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The popover width on a viewport this wide. It shrinks on phones so it never spills out. */
export function popupWidthFor(viewportWidth: number): number {
  return Math.min(POPUP_WIDTH, Math.max(0, viewportWidth - POPUP_MARGIN * 2));
}

/**
 * Pick the popover's top-left corner for the card at `rect`. Beside the card when there is room (left first, so the
 * app sidebar side stays clear, then right). When neither side fits (a narrow screen) it goes above or below the
 * card, whichever has more room. The result is always clamped so the whole panel is inside the viewport.
 */
export function getPopupPosition(
  rect: DOMRect,
  viewport: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): PopupPosition {
  const width = popupWidthFor(viewport.width);
  const height = Math.min(POPUP_HEIGHT, Math.max(0, viewport.height - POPUP_MARGIN * 2));
  const maxLeft = Math.max(POPUP_MARGIN, viewport.width - width - POPUP_MARGIN);
  const maxTop = Math.max(POPUP_MARGIN, viewport.height - height - POPUP_MARGIN);

  const fitsLeft = rect.left >= width + POPUP_MARGIN * 2;
  const fitsRight = rect.right + POPUP_MARGIN + width + POPUP_MARGIN <= viewport.width;

  if (fitsLeft || fitsRight) {
    const desiredLeft = fitsLeft ? rect.left - width - POPUP_MARGIN : rect.right + POPUP_MARGIN;
    // Start level with the top of the card, so the panel sits next to what it describes whatever its height turns out to be.
    return { left: clamp(desiredLeft, POPUP_MARGIN, maxLeft), top: clamp(rect.top, POPUP_MARGIN, maxTop) };
  }

  const roomAbove = rect.top;
  const roomBelow = viewport.height - (rect.top + rect.height);
  const above = roomAbove >= roomBelow;
  const desiredTop = above ? rect.top - height - POPUP_MARGIN : rect.top + rect.height + POPUP_MARGIN;
  const centredLeft = (rect.left + rect.right) / 2 - width / 2;
  return { left: clamp(centredLeft, POPUP_MARGIN, maxLeft), top: clamp(desiredTop, POPUP_MARGIN, maxTop) };
}
