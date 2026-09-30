"use client";

import { useLayoutEffect } from "react";

const PLAYER_LEAVE_MESSAGE =
  "Leave this active duel? You are playing. The duel and any running timer will continue. You can return to the current state.";

const SPECTATOR_LEAVE_MESSAGE =
  "Leave this active duel? You are watching. The duel and any running timer will continue. You can return to the current state.";

const INDEX_KEY = "__yugidraftDuelGuardIndex";

type HistoryState = {
  __NA?: unknown;
  [INDEX_KEY]?: unknown;
};

type AppNavigation = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

let tracking = false;
let nativePush: History["pushState"] | undefined;
let nativeReplace: History["replaceState"] | undefined;
let stackIndex = 0;
let activeTraversalGuard: ((event: PopStateEvent) => void) | null = null;

/** Install before App Router's popstate listener, including on non-duel pages. */
export function DuelNavigationGuard() {
  useLayoutEffect(() => {
    if ("navigation" in window && window.navigation) return;
    pinIndex();
    const onPopState = (event: PopStateEvent) => {
      const index = readIndex(event.state);
      if (index != null) stackIndex = index;
      activeTraversalGuard?.(event);
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, []);
  return null;
}

/**
 * Warn before leaving an active duel. Stay keeps this room's URL, Next tree,
 * and history entry; Leave proceeds once and does not surrender the seat.
 *
 * Cancel same-document Navigation API transitions before the URL changes.
 * Older browsers restore a cancelled traversal using stamped history indices;
 * capture-phase popstate stops Next from rendering the rejected destination.
 * No sentinel entries or history changes on unmount.
 *
 * Link clicks get role-specific confirmation. The matching navigate event
 * consumes that approval so slow App Router transitions do not ask twice.
 * Close, reload, and cross-document traversal use the native browser warning.
 */
export function useDuelLeaveGuard({
  slug,
  active,
  role,
}: {
  slug: string;
  active: boolean;
  role: "player" | "spectator";
}): void {
  useNavigationLeaveGuard(
    active && !!slug,
    role === "player" ? PLAYER_LEAVE_MESSAGE : SPECTATOR_LEAVE_MESSAGE,
    slug,
  );
}

/** Shared link, browser-history, and unload protection for unsaved work. */
export function useNavigationLeaveGuard(active: boolean, message: string, scope = ""): void {
  useLayoutEffect(() => {
    if (!active) return;
    const pinnedHref = window.location.href;
    const nav = (window as Window & { navigation?: AppNavigation }).navigation;
    const navigation = nav && typeof nav.addEventListener === "function" ? nav : null;
    let approvedHref: string | null = null;
    let disposed = false;
    let restoring = false;
    let pinnedIndex = 0;

    const ask = () => window.confirm(message);

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const onPageShow = () => {
      approvedHref = null;
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const dest = parseHref(anchor.href);
      if (!dest) return;
      if (dest.protocol !== "http:" && dest.protocol !== "https:") return;
      if (dest.origin !== window.location.origin) return;
      if (isSamePath(new URL(window.location.href), dest)) return;
      if (ask()) {
        approvedHref = dest.href;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onNavigate = (raw: Event) => {
      if (!raw.cancelable || raw.defaultPrevented) return;
      if (!("destination" in raw)) return;
      const event = raw as Event & {
        hashChange?: unknown;
        downloadRequest?: unknown;
        navigationType?: unknown;
        destination?: { url?: unknown; sameDocument?: boolean };
      };
      if (event.hashChange || event.downloadRequest != null) return;
      if (event.navigationType === "reload") return;
      if (!event.destination?.sameDocument) return;
      if (!event.destination || typeof event.destination.url !== "string") return;
      const dest = parseHref(event.destination.url);
      if (!dest || isSamePath(new URL(window.location.href), dest)) return;
      const approved = approvedHref === dest.href;
      approvedHref = null;
      if (approved || ask()) return;
      raw.preventDefault();
    };

    const onNavigateError = () => {
      if (!disposed) approvedHref = null;
    };

    const onPopState = (event: PopStateEvent) => {
      if (disposed) return;
      if (restoring) {
        restoring = false;
        const restored = readIndex(event.state);
        if (restored != null) pinnedIndex = restored;
        return;
      }

      const now = new URL(window.location.href);
      const pinned = new URL(pinnedHref);
      if (isSamePath(pinned, now) && now.hash !== pinned.hash) return;

      const destIndex = readIndex(event.state);
      const delta = destIndex == null ? -1 : destIndex - pinnedIndex;
      if (delta === 0) return;
      if (ask()) {
        approvedHref = null;
        if (destIndex != null) pinnedIndex = destIndex;
        return;
      }
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go(-delta);
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("click", onClick, true);
    if (navigation) {
      navigation.addEventListener("navigate", onNavigate);
      navigation.addEventListener("navigateerror", onNavigateError);
    } else {
      pinnedIndex = pinIndex();
      activeTraversalGuard = onPopState;
    }

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("click", onClick, true);
      if (navigation) {
        navigation.removeEventListener("navigate", onNavigate);
        navigation.removeEventListener("navigateerror", onNavigateError);
      } else if (activeTraversalGuard === onPopState) {
        activeTraversalGuard = null;
      }
    };
  }, [active, message, scope]);
}

function isSamePath(left: URL, right: URL): boolean {
  return left.origin === right.origin && left.pathname === right.pathname && left.search === right.search;
}

function parseHref(href: string): URL | null {
  try {
    return new URL(href, window.location.href);
  } catch {
    return null;
  }
}

function readIndex(state: unknown): number | undefined {
  if (!state || typeof state !== "object") return undefined;
  const idx = (state as HistoryState)[INDEX_KEY];
  return typeof idx === "number" && Number.isFinite(idx) ? idx : undefined;
}

function stamp(data: unknown, idx: number): HistoryState {
  const base = data && typeof data === "object" ? data : {};
  return { ...base, [INDEX_KEY]: idx };
}

function ensureTracking() {
  if (tracking) return;
  tracking = true;
  nativePush = window.history.pushState.bind(window.history);
  nativeReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = function (data, unused, url) {
    stackIndex += 1;
    return nativePush!(stamp(data, stackIndex), unused, url);
  };
  window.history.replaceState = function (data, unused, url) {
    return nativeReplace!(stamp(data, stackIndex), unused, url);
  };
}

function pinIndex(): number {
  ensureTracking();
  const existing = readIndex(window.history.state);
  if (existing != null) {
    stackIndex = existing;
    return existing;
  }
  stackIndex = 1;
  const state = window.history.state as HistoryState | null;
  if (state && state.__NA === true) {
    nativeReplace!(stamp(state, stackIndex), "");
  }
  return stackIndex;
}
