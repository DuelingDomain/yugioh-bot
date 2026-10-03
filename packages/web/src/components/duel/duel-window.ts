/**
 * Helpers for running a live duel in its own browser window.
 * One named window per duel: a second open focuses the first instead of adding another.
 */

export const DUEL_WINDOW_PARAM = "window";

export function duelWindowName(slug: string): string {
  return `yugidraft-duel-${slug}`;
}

/** Start of the name of the blank window opened at the click, before the server has named the duel. */
export const PENDING_DUEL_WINDOW = "yugidraft-duel-pending";

let pendingCount = 0;

// A different name for each click, so two quick starts (two matches, two tabs) never share a window.
function pendingWindowName(): string {
  pendingCount += 1;
  return `${PENDING_DUEL_WINDOW}-${Date.now().toString(36)}-${pendingCount}`;
}

// Duel windows this page opened. A series reuses one window for every game (the window renames itself),
// so a window is found by its current name and not by the slug it was opened with.
const openedWindows = new Set<Window>();

function nameOf(target: Window): string | null {
  try { return target.name; } catch { return null; }
}

/** The duel window this page opened that now shows `slug`, or null when there is none (or it was closed). */
export function liveDuelWindow(slug: string): Window | null {
  const wanted = duelWindowName(slug);
  let found: Window | null = null;
  for (const target of [...openedWindows]) {
    if (target.closed) { openedWindows.delete(target); continue; }
    if (!found && nameOf(target) === wanted) found = target;
  }
  return found;
}

/** Name an open duel window for the next game of its series before it has moved there itself. */
export function renameDuelWindow(target: Window, slug: string): void {
  try { target.name = duelWindowName(slug); } catch { /* the window renames itself when it loads */ }
}

/** Close a duel window this page opened (the player chose to play in this tab instead). */
export function closeDuelWindow(target: Window | null): void {
  if (!target) return;
  openedWindows.delete(target);
  try { target.close(); } catch { /* the browser keeps it open */ }
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
  openedWindows.add(target);
  return target;
}

/**
 * Open a blank duel window inside a click, before the duel has a slug (the server still has to create
 * it). Pop-up blockers only allow `window.open` in the gesture itself; `navigateDuelWindow` fills it in
 * once the slug is known. Returns null when the browser blocked it.
 */
export function openPendingDuelWindow(): Window | null {
  if (typeof window === "undefined") return null;
  let target: Window | null = null;
  try {
    target = window.open("", pendingWindowName());
  } catch {
    target = null;
  }
  if (!target) return null;
  try {
    // A quiet dark page, so the wait is not a white flash.
    target.document.title = "Starting duel";
    target.document.body.style.cssText = "margin:0;background:#0b0b10;color:#9a9aa8;font:14px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center";
    target.document.body.textContent = "Starting duel…";
  } catch {
    // The window stays blank; it still navigates.
  }
  return target;
}

/** Send a pending window to the duel. False when the player closed it meanwhile (play in place then). */
export function navigateDuelWindow(target: Window, slug: string): boolean {
  try {
    if (target.closed) return false;
    // The slug name lets a later open of this duel find the window again.
    target.name = duelWindowName(slug);
    target.location.href = duelWindowPath(slug);
    target.focus();
  } catch {
    return false;
  }
  openedWindows.add(target);
  return true;
}

/** Close a pending window after a failed start. */
export function closePendingDuelWindow(target: Window | null): void {
  try { target?.close(); } catch { /* the browser keeps it open */ }
}

/** Focus the duel window this page opened for `slug`. False when there is none (or it was closed). */
export function focusOpenDuelWindow(slug: string): boolean {
  const target = liveDuelWindow(slug);
  if (!target) return false;
  try { target.focus(); } catch { /* still counts as open */ }
  return true;
}

/** Slug of a `/duels/<slug>` link, or null for any other href. */
export function duelSlugFromHref(href: string): string | null {
  const match = /^\/duels\/([^/?#]+)/.exec(href);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

/** Click handler for plain /duels/<slug> links: focuses the duel window when this page already opened one. */
export function focusDuelWindowOnClick(href: string, event: { preventDefault(): void; defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void {
  if (event.defaultPrevented || (event.button ?? 0) !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const slug = duelSlugFromHref(href);
  if (slug && focusOpenDuelWindow(slug)) event.preventDefault();
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
