/** Hides a real card while its ghost travels. Each call counts; the card shows again when every call has been released. */
const hiddenCounts = new WeakMap<HTMLElement, number>();

export function hideElement(el: HTMLElement): () => void {
  hiddenCounts.set(el, (hiddenCounts.get(el) ?? 0) + 1);
  // A field zone's card frame stays drawn (it is the zone outline): a mark on it hides what is inside, also what is added
  // later. A hand card's frame is the card itself (gold edge of a revealed card), so it is hidden whole.
  const frame = el.hasAttribute("data-card-frame") && !el.closest("[data-hand-seat]");
  if (frame) el.setAttribute("data-card-hidden", "");
  else el.style.visibility = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (hiddenCounts.get(el) ?? 1) - 1;
    hiddenCounts.set(el, left);
    if (left <= 0) {
      if (frame) el.removeAttribute("data-card-hidden");
      else el.style.removeProperty("visibility");
    }
  };
}
