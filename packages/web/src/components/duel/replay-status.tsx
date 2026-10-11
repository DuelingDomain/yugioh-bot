"use client";

/**
 * One polite line for screen readers: which move is selected and who acted. It speaks when the viewer steps, seeks
 * or pauses and stays empty while autoplay runs, so a playing replay does not read out every move.
 */
export function ReplayStatus({ playing, index, last, caption }: { playing: boolean; index: number; last: number; caption: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-replay-status>
      {playing ? "" : `Move ${index} of ${last}. ${caption}`}
    </p>
  );
}
