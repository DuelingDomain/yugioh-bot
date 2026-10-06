/** A last measure this long after the start: under reduced motion the fields can mount after the first frame. */
export const LATE_MEASURE_MS = 400;

/**
 * Runs `measure` on the next frame, once the board stands still (`settleMs`) and once late (LATE_MEASURE_MS). With
 * `watch` (a pick is open: there are legal targets) it also measures again, on a frame, when the board mounts nodes or
 * marks targets: the fields can mount, mark their targets or finish their entry after the first measure. Without a
 * pick nothing watches the board, so a card that moves costs no measure. Returns the cleanup.
 */
export function watchMeasure(root: HTMLElement, measure: () => void, { settleMs, watch }: { settleMs: number; watch: boolean }): () => void {
  let frame = window.requestAnimationFrame(measure);
  const timer = window.setTimeout(measure, settleMs);
  const late = window.setTimeout(measure, LATE_MEASURE_MS);
  let observer: MutationObserver | null = null;
  if (watch && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-legal"] });
  }
  return () => {
    observer?.disconnect();
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.clearTimeout(late);
  };
}
