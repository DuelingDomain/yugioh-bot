/** Elements that take key presses for themselves: text fields, native selects and the themed select (its button and its list). */
export const TYPING_TARGET = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='combobox'], [role='listbox'], [data-themed-select-layer]";

/** True when a key press (or right-click) lands on such an element. Page-wide shortcuts must skip it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const node = target as HTMLElement;
  if (node.isContentEditable) return true;
  return node.closest(TYPING_TARGET) !== null;
}
