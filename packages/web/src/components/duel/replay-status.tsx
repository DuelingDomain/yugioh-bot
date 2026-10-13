"use client";

import { useEffect, useState } from "react";

/** How long the selected move holds still before it is read out (a slider drag passes many moves in a second). */
export const REPLAY_STATUS_DELAY_MS = 300;

/**
 * One polite line for screen readers: which move is selected and who acted. It speaks when the viewer steps, seeks
 * or pauses and stays empty while autoplay runs, so a playing replay does not read out every move. A change waits
 * a moment: a drag of the slider reads out the move it stops on, not every move it passes (the slider reads its own value).
 */
export function ReplayStatus({ playing, index, last, caption }: { playing: boolean; index: number; last: number; caption: string }) {
  const text = playing ? "" : `Move ${index} of ${last}. ${caption}`;
  const [said, setSaid] = useState(text);
  useEffect(() => {
    // Starting to play empties the line at once; every other change waits for the move to hold still.
    if (text === "") {
      setSaid("");
      return;
    }
    const timer = window.setTimeout(() => setSaid(text), REPLAY_STATUS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-replay-status>
      {said}
    </p>
  );
}
