"use client";

import { useLayoutEffect, useRef } from "react";

const INDEX_KEY = "__yugidraftDuelGuardIndex";

type HistoryState = {
  __NA?: unknown;
  [INDEX_KEY]?: unknown;
};

type AppNavigation = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  traverseTo?(key: string): unknown;
  currentEntry?: { index?: number } | null;
};

/**
 * Replaces the browser confirm with the caller's own dialog. The guard cancels the navigation and calls `request`
 * with `proceed`; the caller runs `proceed()` when the player agrees (after any cleanup it needs) and drops it when
 * the player stays. `navigate` performs an approved link click through the app router.
 */
export type LeaveIntercept = {
  request(proceed: () => void): void;
  navigate(href: string): void;
};

let tracking = false;
let nativePush: History["pushState"] | undefined;
let nativeReplace: History["replaceState"] | undefined;
let stackIndex = 0;
let activeTraversalGuard: ((event: PopStateEvent) => void) | null = null;

/**
 * Starts index tracking for browsers without the Navigation API; returns the cleanup, or undefined when not needed.
 * Mounted once at the root so it runs before App Router's own popstate listener.
 */
export function installTraversalTracking(): (() => void) | undefined {
  if ("navigation" in window && window.navigation) return undefined;
  pinIndex();
  const onPopState = (event: PopStateEvent) => {
    const index = readIndex(event.state);
    if (index != null) stackIndex = index;
    activeTraversalGuard?.(event);
  };
  window.addEventListener("popstate", onPopState, true);
  return () => window.removeEventListener("popstate", onPopState, true);
}

/** Shared link, browser-history, and unload protection for unsaved work. */
export function useNavigationLeaveGuard(active: boolean, message: string, scope = "", intercept?: LeaveIntercept): void {
  const interceptRef = useRef(intercept);
  interceptRef.current = intercept;
  const intercepting = intercept != null;
  useLayoutEffect(() => {
    if (!active) return;
    const pinnedHref = window.location.href;
    const nav = (window as Window & { navigation?: AppNavigation }).navigation;
    const navigation = nav && typeof nav.addEventListener === "function" ? nav : null;
    let approvedHref: string | null = null;
    let disposed = false;
    let restoring = false;
    let approvedTraversal = false;
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
      const custom = interceptRef.current;
      if (custom) {
        event.preventDefault();
        event.stopImmediatePropagation();
        custom.request(() => {
          approvedHref = dest.href;
          custom.navigate(`${dest.pathname}${dest.search}${dest.hash}`);
        });
        return;
      }
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
      if (approved) return;
      const custom = interceptRef.current;
      if (custom) {
        raw.preventDefault();
        const target = event.destination as { key?: string; index?: number };
        custom.request(() => {
          approvedHref = dest.href;
          if (typeof target.key === "string" && typeof navigation?.traverseTo === "function") {
            navigation.traverseTo(target.key);
            return;
          }
          const from = navigation?.currentEntry?.index;
          if (typeof target.index === "number" && typeof from === "number") window.history.go(target.index - from);
          else custom.navigate(`${dest.pathname}${dest.search}${dest.hash}`);
        });
        return;
      }
      if (ask()) return;
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
      if (approvedTraversal) {
        approvedTraversal = false;
        return;
      }

      const now = new URL(window.location.href);
      const pinned = new URL(pinnedHref);
      if (isSamePath(pinned, now) && now.hash !== pinned.hash) return;

      const destIndex = readIndex(event.state);
      const delta = destIndex == null ? -1 : destIndex - pinnedIndex;
      if (delta === 0) return;
      const custom = interceptRef.current;
      if (custom) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(-delta);
        custom.request(() => {
          approvedTraversal = true;
          window.history.go(delta);
        });
        return;
      }
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
  }, [active, message, scope, intercepting]);
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
