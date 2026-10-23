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

const aimClaimed = new WeakSet<Event>();

/** The attack aim used this right click to cancel itself: the drawer must not also close with it (one right click does one thing). */
export function claimAimPress(event: Event): void {
  aimClaimed.add(event);
}

export function aimPressClaimed(event: Event): boolean {
  return aimClaimed.has(event);
}

/** True while a hover drawer is open (a pinned drawer closes through the HUD's own Esc and holds the prompt keys itself). */
export function hoverDrawerOpen(): boolean {
  return typeof document !== "undefined"
    && document.querySelector("[data-testid='hover-preview'][data-open='true']:not([data-pinned])") !== null;
}

/** True while the viewer has a pinned card drawer on screen (it is not tucked away behind a pick prompt). */
export function pinnedDrawerOpen(): boolean {
  return typeof document !== "undefined"
    && document.querySelector("[data-testid='hover-preview'][data-pinned='true'][data-open='true']") !== null;
}

/*
 * What the prompt panel tells the card drawer. Both are module state: the panel and the drawer sit far apart in the tree and in every shell.
 * - `declines`: the viewer has a prompt that Esc and a right click answer (Pass, No, Cancel). Those presses then answer it and the pin stays.
 *   With no such prompt they close the pin.
 * - `pickId`: the id of the viewer's own prompt that asks for a pick on the board (a zone, a card, a target). A pinned drawer must not cover it.
 */
let declines = false;
const picks = new Map<PickSource, string>();
const pickListeners = new Set<() => void>();

/** Who reports a pick: the prompt panel (a zone, a card, a tribute) or the table (an attack target). */
export type PickSource = "panel" | "attack";

export function setPromptDeclines(value: boolean): void {
  declines = value;
}

export function promptDeclines(): boolean {
  return declines;
}

export function setPickPrompt(source: PickSource, id: string | null): void {
  if ((picks.get(source) ?? null) === id) return;
  if (id == null) picks.delete(source);
  else picks.set(source, id);
  for (const listener of pickListeners) listener();
}

export function subscribePickPrompt(listener: () => void): () => void {
  pickListeners.add(listener);
  return () => pickListeners.delete(listener);
}

/** The id of the viewer's open pick prompt, or null. A new id is a new pick: the drawer places itself again. */
export function pickPromptId(): string | null {
  return picks.get("panel") ?? picks.get("attack") ?? null;
}

/** The prompt owns Esc and a right click: it answers with them (Pass, No, Cancel), or it asks for a pick on the board and uses them there. A pin stays then. */
export function promptOwnsPress(): boolean {
  return declines || pickPromptId() != null;
}
