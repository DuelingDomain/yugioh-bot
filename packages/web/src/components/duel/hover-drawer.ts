import { useSyncExternalStore } from "react";
import { useCardHoverInfo } from "./card-hover-info";

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
 * What the prompt panel tells the card drawer. All of it is module state: the panel and the drawer sit far apart in the tree and in every shell.
 * - `declines`: the viewer has a prompt that Esc and a right click answer (Pass, No, Cancel). Those presses then answer it and the pin stays.
 *   With no such prompt they close the pin.
 * - `pickId`: the id of the viewer's own prompt that asks for a pick on the board (a zone, a card, a target, an attack aim). A pinned drawer must not
 *   cover it, and a hover on a target shows that card over the pin.
 * - `viewerPrompt`: the id of any prompt of the viewer that the panel shows (a chain window, yes / no, a position, an option list, an order grid). A
 *   pinned drawer keeps clear of its panel; on a narrow screen it tucks away for all of them.
 */
let declines = false;
let viewerPrompt: string | null = null;
const picks = new Map<PickSource, string>();
const promptListeners = new Set<() => void>();

/** Who reports a pick: the prompt panel (a zone, a card, a tribute) or the table (an attack aim or target). */
export type PickSource = "panel" | "attack";

function notifyPrompts(): void {
  for (const listener of promptListeners) listener();
}

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
  notifyPrompts();
}

/** The panel shows a prompt of the viewer (any kind), or none. */
export function setViewerPrompt(id: string | null): void {
  if (viewerPrompt === id) return;
  viewerPrompt = id;
  notifyPrompts();
}

export function subscribePickPrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
}

/** The id of the viewer's open pick prompt, or null. A new id is a new pick: the drawer places itself again. */
export function pickPromptId(): string | null {
  return picks.get("panel") ?? picks.get("attack") ?? null;
}

/** The id of the viewer's open prompt of any kind (a pick or an answer panel), or null. */
export function anyPromptId(): string | null {
  return pickPromptId() ?? viewerPrompt;
}

/** React view of `pickPromptId`. */
export function usePickPromptId(): string | null {
  return useSyncExternalStore(subscribePickPrompt, pickPromptId, () => null);
}

/** The viewer picks on the board and hover info is on: a hover on a card shows it over a pinned card (hud-preview.ts). */
export function useYieldToHover(): boolean {
  const picking = usePickPromptId() != null;
  const hoverInfo = useCardHoverInfo();
  return picking && hoverInfo !== "off";
}

/** React view of `anyPromptId`. */
export function useAnyPromptId(): string | null {
  return useSyncExternalStore(subscribePickPrompt, anyPromptId, () => null);
}

/** The prompt owns Esc and a right click: it answers with them (Pass, No, Cancel), or it asks for a pick on the board and uses them there. A pin stays then. */
export function promptOwnsPress(): boolean {
  return declines || pickPromptId() != null;
}

/*
 * The kind of the last press: a touch press (a finger or a pen) or a mouse. The width of the window and `(pointer: coarse)` say what the device can do,
 * not what the player just did: a laptop with a touch screen gets both kinds of press.
 */
let touchPress = false;
let tracking = false;

function trackPress(): void {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  window.addEventListener("pointerdown", (event) => { touchPress = event.pointerType === "touch" || event.pointerType === "pen"; }, true);
}
trackPress();

/** True when the last press was a touch (or pen) press. */
export function lastPressWasTouch(): boolean {
  trackPress();
  return touchPress;
}

/**
 * The board stopped moving (a camera zoom ended, a seat left, a drawer finished its reflow): the drawer looks again where it stands. Whoever knows
 * the end of a move may dispatch this event on `window`; the drawer also samples the geometry of the targets itself, so it does not need it.
 */
export const BOARD_SETTLED_EVENT = "duel:board-settled";
