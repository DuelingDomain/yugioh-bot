/** A last measure this long after the start: under reduced motion the fields can mount after the first frame. */
export const LATE_MEASURE_MS = 400;
/** The nodes whose size the watch follows: the zones and the targets the measures read. */
export const WATCHED_SIZES = "[data-zones], [data-legal]";

/**
 * Runs `measure` on the next frame, once the board stands still (`settleMs`) and once late (LATE_MEASURE_MS). With
 * `watch` (a pick is open: there are legal targets) it also measures again, on a frame, when the board mounts nodes or
 * marks targets, and when a zone or a target changes size: the zones can mount at size 0 and lay out later with no DOM
 * change (a slow first paint passes the late measure). Without a pick nothing watches the board, so a card that moves
 * costs no measure. Returns the cleanup.
 */
export function watchMeasure(root: HTMLElement, measure: () => void, { settleMs, watch }: { settleMs: number; watch: boolean }): () => void {
  let frame = window.requestAnimationFrame(measure);
  const timer = window.setTimeout(measure, settleMs);
  const late = window.setTimeout(measure, LATE_MEASURE_MS);
  let observer: MutationObserver | null = null;
  let sizes: ResizeObserver | null = null;
  if (watch) {
    const again = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    if (typeof ResizeObserver !== "undefined") sizes = new ResizeObserver(again);
    // observe() is a no-op for a node it already follows, so new nodes join on each mutation.
    const follow = () => root.querySelectorAll(WATCHED_SIZES).forEach((node) => sizes?.observe(node));
    follow();
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        follow();
        again();
      });
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-legal"] });
    }
  }
  return () => {
    observer?.disconnect();
    sizes?.disconnect();
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.clearTimeout(late);
  };
}
