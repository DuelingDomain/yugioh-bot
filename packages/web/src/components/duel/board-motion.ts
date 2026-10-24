/**
 * "The board is moving": one place that knows when the table, the camera or the layout is in motion, so a click is
 * never read against a board that is not where the player saw it. A seat that leaves (4 seats to 3 to 2), a camera
 * zoom, a drawer that reflows the table, the Tag roof camera and the 3D plane all slide for a moment. A click in that
 * moment lands on whatever slid under the pointer.
 *
 * Sources tell this module when they move:
 * - `beginBoardMotion()` for a move the code drives (a rAF zoom, a camera tween). Call the returned function at its end.
 * - `trackBoardMotion(animation)` for a Web Animation (the FLIP of a seat, the roof tween).
 * - `holdBoardMotion()` for a layout that jumps with no animation (reduced motion, a resize).
 * - `watchBoardTransitions()` for the CSS transitions of the seats and the board layers (see MOVERS).
 *
 * `boardMoving()` is true while any move runs and for `BOARD_SETTLE_MS` after the last one ends. The input guard
 * (board-input-guard.ts) uses it; so does the card menu, which closes when a move starts.
 */

/** How long after the last move ends a click is still held back: the pointer needs a moment to see the board at rest. */
export const BOARD_SETTLE_MS = 200;
/** A move that never reports its end (its node left the page) is dropped after this long. */
const CAP_MS = 4000;

type Listener = () => void;

const active = new Set<symbol>();
const startListeners = new Set<Listener>();
let quietAt = 0;
let stamp = 0;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** True while the board moves, and for the settle time after. */
export function boardMoving(): boolean {
  return active.size > 0 || clock() < quietAt;
}

/** Grows with every move that starts: a press and its release that see different stamps were split by a move. */
export function boardMotionStamp(): number {
  return stamp;
}

/** Calls `listener` each time the board goes from still to moving. Returns the cleanup. */
export function onBoardMotionStart(listener: Listener): () => void {
  startListeners.add(listener);
  return () => {
    startListeners.delete(listener);
  };
}

/**
 * Tells the page the board came to rest (moving to settled, after the settle time): anything placed against the board
 * (the pinned card drawer) re-places itself on this window event. Fires once per rest, not once per move.
 */
function armSettled() {
  if (typeof window === "undefined") return;
  if (settleTimer) clearTimeout(settleTimer);
  if (active.size > 0) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (boardMoving()) return armSettled();
    window.dispatchEvent(new Event("duel:board-settled"));
  }, Math.max(0, quietAt - clock()) + 1);
}

function started(wasMoving: boolean) {
  stamp += 1;
  if (wasMoving) return;
  for (const listener of [...startListeners]) listener();
}

/** A move starts. Call the returned function when it ends (more than once is fine). `settleMs` 0 is for a move of the player's own hand. */
export function beginBoardMotion(settleMs: number = BOARD_SETTLE_MS): () => void {
  const wasMoving = boardMoving();
  const token = Symbol("board-motion");
  active.add(token);
  const cap = setTimeout(() => end(), CAP_MS);
  const end = () => {
    if (!active.delete(token)) return;
    clearTimeout(cap);
    quietAt = Math.max(quietAt, clock() + settleMs);
    armSettled();
  };
  started(wasMoving);
  return end;
}

/** The board jumped to a new layout with no animation: hold clicks for the settle time. */
export function holdBoardMotion(ms: number = BOARD_SETTLE_MS): void {
  const wasMoving = boardMoving();
  quietAt = Math.max(quietAt, clock() + ms);
  started(wasMoving);
  armSettled();
}

/** A Web Animation that moves the board. It counts as motion until it finishes or is cancelled. Returns the animation. */
export function trackBoardMotion<T extends Animation | null | undefined>(animation: T): T {
  if (!animation) return animation;
  const end = beginBoardMotion();
  const done = () => end();
  if (animation.finished) animation.finished.then(done, done);
  else {
    animation.addEventListener?.("finish", done);
    animation.addEventListener?.("cancel", done);
  }
  return animation;
}

/** The nodes whose transform transition is a move of the board: a seat, and the layers of the board that carry `data-board-motion`. */
const MOVERS = "[data-seat-slot], [data-board-motion]";
const MOVING_PROPS = new Set(["transform", "translate", "rotate", "scale"]);

/**
 * Follows the CSS transitions of the movers on the page (the events bubble, so one listener on the window sees them all).
 * A transition counts from `transitionstart` (after its delay: the regroup waits a crumble before it glides) to its end or cancel.
 * Returns the cleanup.
 */
export function watchBoardTransitions(host: EventTarget = window): () => void {
  const open = new Map<Element, Map<string, () => void>>();
  const target = (event: TransitionEvent): Element | null => {
    if (event.pseudoElement) return null;
    const node = event.target as Element | null;
    return node?.matches?.(MOVERS) && MOVING_PROPS.has(event.propertyName) ? node : null;
  };
  const close = (raw: Event) => {
    const event = raw as TransitionEvent;
    const node = target(event);
    const props = node ? open.get(node) : undefined;
    const end = props?.get(event.propertyName);
    if (!node || !props || !end) return;
    props.delete(event.propertyName);
    if (props.size === 0) open.delete(node);
    end();
  };
  const onStart = (raw: Event) => {
    const event = raw as TransitionEvent;
    const node = target(event);
    if (!node) return;
    close(event);
    const props = open.get(node) ?? new Map<string, () => void>();
    props.set(event.propertyName, beginBoardMotion());
    open.set(node, props);
  };
  host.addEventListener("transitionstart", onStart);
  host.addEventListener("transitionend", close);
  host.addEventListener("transitioncancel", close);
  return () => {
    host.removeEventListener("transitionstart", onStart);
    host.removeEventListener("transitionend", close);
    host.removeEventListener("transitioncancel", close);
    for (const props of open.values()) for (const end of props.values()) end();
    open.clear();
  };
}
