/**
 * Finding the box a zone key marks on a 4-way table. A compact rival field keeps its real board mounted but
 * hidden (so the FX can measure it), and its chips carry the very same keys. A pointer, an arrow or a confirm
 * must land on what the player sees, so a node inside a hidden compact board does not count while a chip does.
 */
const HIDDEN_BOARD = '[data-compact="true"] [data-seat-field]';

const visibleBox = (node: Element) => {
  const r = node.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
};

/** The first node of a selector that is not part of a hidden compact board (a chip, or a plain field). */
export function findShown(scope: ParentNode, selector: string): Element | null {
  const all = scope.querySelectorAll(selector);
  let fallback: Element | null = null;
  for (const node of all) {
    if (node.closest(HIDDEN_BOARD)) {
      fallback ??= node;
      continue;
    }
    if (visibleBox(node)) return node;
    fallback ??= node;
  }
  return fallback ?? all[0] ?? null;
}

/** The element a zone key marks (the card button when it has one), with a compact chip winning over its hidden board. */
export function tableZoneAnchor(key: string, scope: ParentNode = document): HTMLElement | null {
  const zone = findShown(scope, `[data-zones~="${key}"]`) as HTMLElement | null;
  return zone?.querySelector<HTMLElement>("button") ?? zone;
}
