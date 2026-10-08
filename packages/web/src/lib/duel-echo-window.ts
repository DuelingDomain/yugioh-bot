/**
 * The change notice that the player's own answer causes comes back over the socket a moment after the answer's
 * own reply (the reply already carries the new room). Re-reading the room for it is still right, but it must not
 * raise the "syncing" flag, which the room shows as a re-read. This window says when a notice is that echo: while an
 * answer is in flight and for a short time after it. A notice outside the window (an opponent's move) raises the
 * "syncing" flag for the read, but that flag no longer shuts prompts or zones (only a recovering connection does).
 * Clicks that are not held are still checked by the duel host against the prompt id and revision, so a click on a
 * prompt that changed meanwhile is refused, not applied.
 * An echo later than the window (a slow network) is treated as a change and shows the "syncing" flag for one read.
 */
export const ECHO_QUIET_MS = 800;

export type EchoWindow = {
  /** An answer is sent. */
  begin: () => void;
  /** The answer's reply is applied (or failed). */
  end: () => void;
  /** True when a change notice now is the echo of the player's own answer. */
  quiet: () => boolean;
};

export function createEchoWindow(now: () => number = () => Date.now(), quietMs: number = ECHO_QUIET_MS): EchoWindow {
  let pending = 0;
  let endedAt = Number.NEGATIVE_INFINITY;
  return {
    begin: () => { pending += 1; },
    end: () => { pending = Math.max(0, pending - 1); endedAt = now(); },
    quiet: () => pending > 0 || now() - endedAt < quietMs,
  };
}
