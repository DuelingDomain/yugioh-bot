/**
 * The change notice that the player's own answer causes comes back over the socket a moment after the answer's
 * own reply (the reply already carries the new room). Re-reading the room for it is still right, but it must not
 * raise the "syncing" flag: that flag shuts every prompt and zone click until the extra read ends. This window says
 * when a notice is that echo: while an answer is in flight and for a short time after it. A notice outside the window
 * (an opponent's move) keeps the full gate. Clicks that the gate no longer holds are still checked by the duel host
 * against the prompt id and revision, so a click on a prompt that changed meanwhile is refused, not applied.
 * An echo later than the window (a slow network) is treated as a change: the room is shut for one read, buttons off,
 * and a continuing prompt does not skip the wait for it (see `skipsAnswerableWait`).
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
