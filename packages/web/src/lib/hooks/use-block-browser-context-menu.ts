"use client";

import { useEffect } from "react";

/** Set on <html> while a duel page is mounted; globals.css turns off the iOS long-press callout under it. */
export const DUEL_NO_CALLOUT_ATTRIBUTE = "data-duel-no-callout";

/**
 * Keeps the browser's own right-click menu off the whole duel page: board, hands, prompts, log and
 * empty space. Only preventDefault runs here. The event keeps bubbling, so our own onContextMenu
 * handlers (deck Surrender menu, card menus) still fire. The listener is on the document and goes
 * away on unmount, so other pages keep the normal browser menu.
 */
export function useBlockBrowserContextMenu() {
  useEffect(() => {
    const block = (event: Event) => event.preventDefault();
    const root = document.documentElement;
    document.addEventListener("contextmenu", block);
    root.setAttribute(DUEL_NO_CALLOUT_ATTRIBUTE, "");
    return () => {
      document.removeEventListener("contextmenu", block);
      root.removeAttribute(DUEL_NO_CALLOUT_ATTRIBUTE);
    };
  }, []);
}
