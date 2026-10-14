import type { Rect } from "./rect-util";

/**
 * The box every prompt of a multi-seat table is centred in (board px): the whole width of the board, and down the band
 * of the fields (the union of `frames`), so a prompt sits in the middle of the screen and a panel that keeps to the
 * band's height never reaches the life plates above and below the fields. It is read from the board and its layout only,
 * never from the camera or a zoom: the prompt is not part of the zoomed world, so it stays put when the view changes.
 * With no frame (a table that is not laid out yet) the box is the whole board.
 */
export function centeredPromptBox(box: { width: number; height: number }, frames: readonly (Rect | null)[]): Rect {
  const live = frames.filter((frame): frame is Rect => frame != null && frame.width > 0 && frame.height > 0);
  if (live.length === 0) return { x: 0, y: 0, width: box.width, height: box.height };
  const top = Math.min(...live.map((frame) => frame.y));
  const bottom = Math.max(...live.map((frame) => frame.y + frame.height));
  return { x: 0, y: top, width: box.width, height: bottom - top };
}
