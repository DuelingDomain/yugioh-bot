/**
 * Helpers for running a live duel in its own browser window.
 * One named window per duel: a second open focuses the first instead of adding another.
 */

export const DUEL_WINDOW_PARAM = "window";

export function duelWindowName(slug: string): string {
  return `yugidraft-duel-${slug}`;
}

export function duelWindowPath(slug: string): string {
  return `/duels/${encodeURIComponent(slug)}?${DUEL_WINDOW_PARAM}=1`;
}

/** True when this page is the duel window (query flag, or window name set by an earlier open). */
export function isDuelWindow(slug: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(window.location.href).searchParams.get(DUEL_WINDOW_PARAM) === "1"
      || window.name === duelWindowName(slug);
  } catch {
    return false;
  }
}

/**
 * Open (or focus) the duel window. Call inside a user gesture so pop-up blockers allow it.
 * Returns null when the browser blocked it.
 */
export function openDuelWindow(slug: string): Window | null {
  if (typeof window === "undefined") return null;
  let target: Window | null = null;
  try {
    // An empty URL returns the existing named window without reloading it.
    target = window.open("", duelWindowName(slug));
  } catch {
    target = null;
  }
  if (!target) return null;
  try {
    if (target.location.href === "about:blank") target.location.href = duelWindowPath(slug);
    else target.focus();
  } catch {
    target.focus();
  }
  return target;
}

/**
 * Leave the duel from the duel window. The opener tab goes to the duels list when it still shows
 * this duel; the window then closes. Falls back to `fallback` when the browser refuses to close.
 */
export function exitDuelWindow(slug: string, fallback: () => void): void {
  try {
    const opener = window.opener as Window | null;
    if (opener && !opener.closed && opener.location.pathname === `/duels/${slug}`) {
      opener.location.assign("/duels");
    }
  } catch {
    // Cross-origin or detached opener: nothing to update.
  }
  try {
    window.close();
  } catch {
    // Fall through to the navigation fallback.
  }
  // A window that could not close is still open a moment later.
  window.setTimeout(() => {
    if (!window.closed) fallback();
  }, 150);
}
