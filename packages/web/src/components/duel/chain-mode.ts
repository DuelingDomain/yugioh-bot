import type { DuelChainMode } from "@yugidraft/shared/duels";

/**
 * The chain response switch: what it says, what it remembers, and what the R key does.
 * The server owns the mode (per seat, private); this module is only the browser's side.
 */

export const CHAIN_MODE_STORAGE_KEY = "duel.chainMode.v1";

export const CHAIN_MODE_LABEL: Record<DuelChainMode, string> = {
  auto: "Auto",
  always: "Always",
  off: "Off",
};

/** Tooltips. Off says plainly that it also skips your own optional "you can" effects. */
export const CHAIN_MODE_HINT: Record<DuelChainMode, string> = {
  auto: "Auto: ask only when a card can respond.",
  always: "Always: stop at every window that lists a card, even when none fits.",
  off: "Off: pass every optional response, including your own 'you can' effects.",
};

/** The two states a player settles on. Off is a moment, not a preference, so it is never remembered. */
export type RememberedChainMode = Exclude<DuelChainMode, "off">;

export function isRememberedChainMode(value: unknown): value is RememberedChainMode {
  return value === "auto" || value === "always";
}

/** The last Auto or Always this browser chose, or null (nothing stored, bad value, storage blocked). */
export function loadRememberedChainMode(): RememberedChainMode | null {
  try {
    const raw = window.localStorage.getItem(CHAIN_MODE_STORAGE_KEY);
    return isRememberedChainMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Off is ignored: the next duel should not start with the player passing everything. */
export function rememberChainMode(mode: DuelChainMode): void {
  if (!isRememberedChainMode(mode)) return;
  try {
    window.localStorage.setItem(CHAIN_MODE_STORAGE_KEY, mode);
  } catch {
    // private window / quota: the switch still works, it just forgets
  }
}

/** What R does: Off from either state, and back to the state you left when it is already Off. */
export function hotkeyTarget(current: DuelChainMode, lastOn: RememberedChainMode): DuelChainMode {
  return current === "off" ? lastOn : "off";
}

/**
 * Whether a key press may be taken as the R shortcut. Typing, a modifier chord, a held key and an open dialog all
 * keep the key for themselves.
 */
export function isChainHotkey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "defaultPrevented" | "target">): boolean {
  if (event.key !== "r" && event.key !== "R") return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented) return false;
  const target = event.target as HTMLElement | null;
  if (target && typeof target.closest === "function") {
    if (target.isContentEditable) return false;
    if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return false;
  }
  if (typeof document !== "undefined" && document.querySelector("[role='dialog'][aria-modal='true'], dialog[open]")) return false;
  return true;
}
