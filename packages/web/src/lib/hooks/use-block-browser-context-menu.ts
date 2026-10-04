"use client";

import { useEffect } from "react";

/** Set on <html> while a duel page is mounted; globals.css turns off the iOS long-press callout under it. */
export const DUEL_NO_CALLOUT_ATTRIBUTE = "data-duel-no-callout";

/** Text fields keep the native menu so players can paste (bug-report form, prompt input, Android paste). Same list as prompt-center.tsx. */
const EDITABLE_SELECTOR = "input,textarea,select,[contenteditable='true']";

/**
 * Keeps the browser's own right-click menu off the whole duel page (board, hands, prompts, log, empty
 * space), except in text fields. Only preventDefault runs here, so our own onContextMenu handlers (deck
 * Surrender menu, card menus) still fire. The listener sits on the document in the capture phase: a
 * handler that only calls stopPropagation (React stops the native event at its root) cannot leave the
 * native menu open. It goes away on unmount, so other pages keep the normal browser menu.
 */
export function useBlockBrowserContextMenu() {
  useEffect(() => {
    const block = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(EDITABLE_SELECTOR)) return;
      event.preventDefault();
    };
    const root = document.documentElement;
    document.addEventListener("contextmenu", block, true);
    root.setAttribute(DUEL_NO_CALLOUT_ATTRIBUTE, "");
    return () => {
      document.removeEventListener("contextmenu", block, true);
      root.removeAttribute(DUEL_NO_CALLOUT_ATTRIBUTE);
    };
  }, []);
}
