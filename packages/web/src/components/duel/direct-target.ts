import { findShown } from "./table/zone-find";

/**
 * Where a direct attack lands. A direct attack is aimed at the defending player's FIELD (the row of their five Monster
 * Zones, as it is seen in the current camera), not at their LP plate. The damage is then shown on the plate, as before.
 * Every layer that aims or strikes a seat (the aim arrow, the attack line, the declared marker, the attack FX) reads the node
 * from here, so they point to the same place in 1v1, FFA and Tag, and under any tilt, turn or zoom (the node is measured live).
 */

/** Marks the row of Monster Zones of a seat (`data-monster-row="<seat>"`). */
export const MONSTER_ROW_ATTR = "data-monster-row";

const sized = (node: Element): boolean => {
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** The node has a box that meets the screen (a field the camera moved out of view does not). */
const onScreen = (node: Element): boolean => {
  const r = node.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
};

/**
 * The node that stands for the field of a seat: its row of Monster Zones, else its field mat, else (a board that is not
 * on screen) its LP plate. The first one that is on the screen wins; then the first one that has a box; with none, the first one that exists.
 */
export function directTargetNode(seat: number, scope: ParentNode = document): Element | null {
  const chain = [
    `[${MONSTER_ROW_ATTR}="${seat}"]`,
    `[data-seat-field="${seat}"]`,
    `[data-holo="${seat}"], [data-lp-seat="${seat}"]`,
  ];
  let sizedNode: Element | null = null;
  let fallback: Element | null = null;
  for (const selector of chain) {
    const node = findShown(scope, selector);
    if (!node) continue;
    if (onScreen(node)) return node;
    if (!sizedNode && sized(node)) sizedNode = node;
    fallback ??= node;
  }
  return sizedNode ?? fallback;
}
