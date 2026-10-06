/**
 * The seat of the 4-way grid whose field box holds a point (the nearest centre where two facing boxes overlap), NaN when
 * none does. Out fields are excluded. A field box takes no pointer of its own (field.module.css), so a click or a hover on
 * empty mat is found here, from its point on the screen. Other layouts have no `data-grid-cell`: the answer is NaN.
 */
export function seatAtPoint(root: ParentNode, x: number, y: number): number {
  let seat = NaN;
  let best = Infinity;
  for (const field of root.querySelectorAll<HTMLElement>("[data-seat-field]")) {
    const cell = field.closest<HTMLElement>("[data-grid-cell]");
    if (!cell || cell.dataset.cellState === "out") continue;
    const rect = field.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
    if (distance < best) {
      best = distance;
      seat = Number(cell.dataset.gridCell);
    }
  }
  return seat;
}
