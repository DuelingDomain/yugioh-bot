/** Card art for a list loads a few images at a time, so a long list does not flood the card image route. */
export const MAX_IMAGES_IN_FLIGHT = 6;
const HUNG_IMAGE_MS = 20_000;

let active = 0;
const waiting: Array<() => void> = [];

function pump(): void {
  while (active < MAX_IMAGES_IN_FLIGHT && waiting.length) {
    active += 1;
    waiting.shift()?.();
  }
}

/**
 * Asks for a slot. `onGrant` runs when one is free; the returned function gives the slot back
 * (or leaves the queue). It is safe to call more than once. A slot is also freed after twenty seconds,
 * so one stuck image cannot block the rest.
 */
export function requestImageSlot(onGrant: () => void): () => void {
  let state: "waiting" | "granted" | "done" = "waiting";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const entry = () => {
    state = "granted";
    timer = setTimeout(release, HUNG_IMAGE_MS);
    onGrant();
  };
  function release() {
    if (state === "done") return;
    if (timer) clearTimeout(timer);
    if (state === "granted") active -= 1;
    else {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
    }
    state = "done";
    pump();
  }
  waiting.push(entry);
  pump();
  return release;
}

/** Test helper: forget every slot and queued request. */
export function resetImageQueue(): void {
  active = 0;
  waiting.length = 0;
}
