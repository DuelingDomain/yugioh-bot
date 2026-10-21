/**
 * The card drawer owns the first Esc and the first right click. The prompt panels check these before they answer, so one press closes the
 * drawer and the next press goes to the prompt. (The drawer may close in the same event, so the claim stays set for later listeners.)
 */
const claimed = new WeakSet<Event>();

/** The drawer used this press to close itself: the prompt must not answer with it. */
export function claimDrawerPress(event: Event): void {
  claimed.add(event);
}

export function drawerClaimed(event: Event): boolean {
  return claimed.has(event);
}

/** True while a hover drawer is open (a pinned drawer closes through the HUD's own Esc and holds the prompt keys itself). */
export function hoverDrawerOpen(): boolean {
  return typeof document !== "undefined"
    && document.querySelector("[data-testid='hover-preview'][data-open='true']:not([data-pinned])") !== null;
}
