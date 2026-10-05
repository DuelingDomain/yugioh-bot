/**
 * FLIP for the 4-way grid. The stage writes the FINAL size and place of a box (left, top, width, height), then calls
 * `playFlip`: the box starts at the rect it showed a moment ago (a translate and a scale from the new rect) and moves
 * back to `transform: none`. At rest no box carries a transform, so text is crisp. The pure part (boxes, the visual
 * box of a move that is still running) has no DOM and is unit tested.
 */

export const FLIP_MS = 500;
export const FLIP_EASING = "cubic-bezier(.2,.8,.2,1)";

/** A box by its centre, so a scale about the centre of the box is the same whatever the turn of the box. */
export interface FlipBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export const boxOf = (rect: { x: number; y: number; width: number; height: number }): FlipBox => ({
  cx: rect.x + rect.width / 2,
  cy: rect.y + rect.height / 2,
  w: rect.width,
  h: rect.height,
});

/** The transform that makes a box at `to` look like it is at `from`. */
export interface FlipDelta {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}

export function flipDelta(from: FlipBox, to: FlipBox): FlipDelta {
  return {
    dx: from.cx - to.cx,
    dy: from.cy - to.cy,
    sx: to.w > 0 ? from.w / to.w : 1,
    sy: to.h > 0 ? from.h / to.h : 1,
  };
}

const NEAR = 0.5;

/** True when two boxes differ enough to be worth a move. */
export function boxesDiffer(a: FlipBox, b: FlipBox): boolean {
  return Math.abs(a.cx - b.cx) > NEAR || Math.abs(a.cy - b.cy) > NEAR || Math.abs(a.w - b.w) > NEAR || Math.abs(a.h - b.h) > NEAR;
}

/** The box a move shows at eased `progress` (0 = at `from`, 1 = at its final box `to`). */
export function boxAt(to: FlipBox, delta: FlipDelta, progress: number): FlipBox {
  const rest = 1 - Math.min(1, Math.max(0, progress));
  return {
    cx: to.cx + delta.dx * rest,
    cy: to.cy + delta.dy * rest,
    w: to.w * (1 + (delta.sx - 1) * rest),
    h: to.h * (1 + (delta.sy - 1) * rest),
  };
}

/** The css transform of a delta. `turn` is the box's own turn (180 for a top field): a translate is turned with it. */
export function flipTransform(delta: FlipDelta, turn: 0 | 180): string {
  const sign = turn === 180 ? -1 : 1;
  return `translate(${(delta.dx * sign).toFixed(2)}px, ${(delta.dy * sign).toFixed(2)}px) scale(${delta.sx.toFixed(4)}, ${delta.sy.toFixed(4)})`;
}

/** What the stage remembers of a box: where it rests now and the move that is running into that place. */
export interface FlipTrack {
  box: FlipBox;
  delta: FlipDelta | null;
  anim: Animation | null;
  /** Animations on the text of the box (the life panel fades it during the move). */
  text: Animation[];
}

/** The box a track shows right now: its resting box, or where its running move has got to. */
export function visualBox(track: FlipTrack): FlipBox {
  const anim = track.anim;
  if (!anim || !track.delta) return track.box;
  const progress = anim.effect?.getComputedTiming().progress;
  if (typeof progress !== "number") return track.box;
  return boxAt(track.box, track.delta, progress);
}

export interface FlipOptions {
  turn: 0 | 180;
  /** Fade the text between 15% and 70% of the move when the box changes size (the numerals of a life panel). */
  fadeText: boolean;
  duration?: number;
  /** A curve other than the usual one (the finale glide). */
  easing?: string;
}

const canAnimate = (el: Element): el is HTMLElement & { animate: Element["animate"] } => typeof (el as Element).animate === "function";

function cancelTrack(track: FlipTrack | undefined) {
  if (!track) return;
  track.anim?.cancel();
  for (const animation of track.text) animation.cancel();
}

/** Opacity of the text fade at a progress 0..1 of its move (the keyframes of `playFlip`, linear between them). */
export function textFadeAt(progress: number): number {
  if (progress <= 0.15) return 1 - progress / 0.15;
  if (progress < 0.7) return 0;
  return Math.min(1, (progress - 0.7) / 0.3);
}

/** Where the text fade of a running track is now (1 when none runs). */
function runningTextOpacity(track: FlipTrack): number {
  const first = track.text[0];
  const progress = first?.effect?.getComputedTiming().progress;
  return typeof progress === "number" ? textFadeAt(progress) : 1;
}

/**
 * Moves `el` from where its track showed it to `next`. Returns the new track. With `animate` false (first layout, a
 * resize, reduced motion) a running move is cancelled and the box jumps to its place.
 */
export function playFlip(el: HTMLElement, previous: FlipTrack | undefined, next: FlipBox, animate: boolean, options: FlipOptions): FlipTrack {
  const from = previous ? visualBox(previous) : null;
  // A move that stops a move must not restart the text fade at full opacity (the numerals would flash): read where the
  // running fade is before it is cancelled, and start the new one from there.
  const textStart = previous ? runningTextOpacity(previous) : 1;
  cancelTrack(previous);
  const rest: FlipTrack = { box: next, delta: null, anim: null, text: [] };
  if (!animate || !from || !boxesDiffer(from, next) || !canAnimate(el)) return rest;
  const delta = flipDelta(from, next);
  const duration = options.duration ?? FLIP_MS;
  const anim = el.animate([{ transform: flipTransform(delta, options.turn) }, { transform: "none" }], { duration, easing: options.easing ?? FLIP_EASING });
  const clear = () => {
    if (rest.anim === anim) {
      rest.anim = null;
      rest.delta = null;
    }
  };
  anim.addEventListener("finish", clear);
  anim.addEventListener("cancel", clear);
  rest.anim = anim;
  rest.delta = delta;
  if (options.fadeText && (Math.abs(delta.sx - 1) > 0.01 || Math.abs(delta.sy - 1) > 0.01)) {
    for (const node of el.querySelectorAll<HTMLElement>("[data-holo-text]")) {
      rest.text.push(
        node.animate(
          [
            { opacity: textStart, offset: 0 },
            { opacity: 0, offset: 0.15 },
            { opacity: 0, offset: 0.7 },
            { opacity: 1, offset: 1 },
          ],
          { duration, easing: "linear" },
        ),
      );
    }
  }
  return rest;
}

/** Stops every running move of the tracks (a resize, or the stage unmounts). */
export function cancelTracks(tracks: Iterable<FlipTrack>) {
  for (const track of tracks) cancelTrack(track);
}
