/**
 * The face-off of a 4-way grid: when two seats are left, their two fields glide to sit in front of each other in the middle
 * of the table, like the two sides of the 1v1 room ("FINAL DUEL"). It is a visual change only. The fields do not join and
 * the rules do not change: the facing pairs (0+1, 2+3) stay fixed. Each field keeps its own Extra Monster row, and two
 * seats of one pair keep the link between those rows (the hover light, the pair badge); two seats of different pairs have none.
 * The timing (after the crumble of the last seat out, and a beat) is in final-duel-caption.ts `useFinalDuel`; this is the pure model.
 */

/** How long the last two take to glide to the face-off, and the curve of the glide. */
export const FINALE_GLIDE_MS = 1400;
export const FINALE_GLIDE_EASING = "cubic-bezier(.5,0,.2,1)";

/** "same": the two left are one facing pair (their Extra Monster rows are linked). "cross": they come from two pairs (no link). */
export type FinaleKind = "same" | "cross";

/** The face-off: who sits at the bottom (turned 0) and at the top (turned 180) of the 1v1 composition. */
export interface GridFinaleBoard {
  kind: FinaleKind;
  bottom: number;
  top: number;
}

/** Where a seat sits on the grid (see grid-layout.ts `gridCells`). */
export interface FinaleCell {
  seat: number;
  column: 0 | 1;
  row: 0 | 1;
  home: boolean;
}

/**
 * The face-off of two live seats, or null for any other count. The bottom seat: the home seat (you, or a spectator's
 * anchor) when it is one of the two; else the one on the bottom row when only one is; else the one in the home column.
 * The other is the top seat.
 */
export function finaleBoard(live: readonly number[], cells: readonly FinaleCell[]): GridFinaleBoard | null {
  if (live.length !== 2) return null;
  const a = cells.find((cell) => cell.seat === live[0]);
  const b = cells.find((cell) => cell.seat === live[1]);
  if (!a || !b) return null;
  const kind: FinaleKind = a.column === b.column ? "same" : "cross";
  let bottom: FinaleCell;
  if (a.home || b.home) bottom = a.home ? a : b;
  else if (a.row !== b.row) bottom = a.row === 1 ? a : b;
  else {
    const homeColumn = cells.find((cell) => cell.home)?.column ?? 0;
    bottom = a.column === homeColumn ? a : b;
  }
  const top = bottom === a ? b : a;
  return { kind, bottom: bottom.seat, top: top.seat };
}
