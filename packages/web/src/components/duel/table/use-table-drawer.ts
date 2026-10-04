"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { DURATION, usePrefersReducedMotion } from "@/lib/motion";
import type { SidePane } from "../side-panel";
import { drawerPane, drawerPanes, type RailButtonKey } from "./table-rail";
import type { TableUi } from "./use-table-ui";

/** localStorage key of the viewer's drawer: open or closed, and the last tab. Per browser, never shared. */
export const DRAWER_STORAGE_KEY = "duel-table-drawer";

/** The slide-in lasts this long (`--d-drawer-in`); the board glides to its new fit in the same time. */
export const DRAWER_IN_MS = 300;

export interface StoredDrawer {
  open: boolean;
  pane: SidePane;
}

const PANES: readonly SidePane[] = ["card", "log", "masters", "settings"];

export function readStoredDrawer(storage: Pick<Storage, "getItem"> | null | undefined = safeStorage()): StoredDrawer | null {
  try {
    const raw = storage?.getItem(DRAWER_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredDrawer> | null;
    if (!value || typeof value.open !== "boolean") return null;
    const pane = PANES.includes(value.pane as SidePane) ? (value.pane as SidePane) : "card";
    return { open: value.open, pane };
  } catch {
    return null;
  }
}

export function writeStoredDrawer(value: StoredDrawer, storage: Pick<Storage, "setItem"> | null | undefined = safeStorage()): void {
  try {
    storage?.setItem(DRAWER_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private windows and blocked site data: the drawer still works, it just does not remember.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** True while this module dispatches its own `resize`, so the resize listener can tell it from a real one. */
let synthetic = false;

/** Measurers that read the board once (battle FX, the attack confirm, the move plan) listen to `resize`. */
export function dispatchReflowResize(): void {
  if (typeof window === "undefined") return;
  synthetic = true;
  try {
    window.dispatchEvent(new Event("resize"));
  } finally {
    synthetic = false;
  }
}

export type GlideKind = "drawer-in" | "drawer-out" | "resize" | "none";

export interface TableDrawer {
  open: boolean;
  pane: SidePane;
  panes: readonly SidePane[];
  /** False until the stored state has been applied: the first paint then skips the slide. */
  settled: boolean;
  /** How the board should move for the current change; the shell writes it to `data-glide`. */
  glide: GlideKind | null;
  viewOpen: boolean;
  /** A rail button: opens the drawer on this pane, or closes it when that pane is already showing. */
  togglePane: (pane: SidePane) => void;
  toggleView: () => void;
  close: (restoreFocus?: boolean) => void;
  /** Esc inside the rail or the drawer closes the drawer and gives focus back to the button that opened it. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  register: (key: RailButtonKey, element: HTMLButtonElement | null) => void;
}

/**
 * The wide table's drawer: open state (kept in `ui` so a card inspect can open it), the pane, the viewer's stored choice,
 * and the reflow window. While the table re-fits around the drawer the hook tells the shell how to glide and keeps firing
 * `resize` once a frame, so everything that measures the board once re-reads the moving seats and never keeps a stale spot.
 */
export function useTableDrawer(ui: TableUi, opts: { domain: boolean; reducedMotion: boolean; enabled: boolean }): TableDrawer {
  const { domain, enabled } = opts;
  const mediaReduced = usePrefersReducedMotion();
  const reduced = opts.reducedMotion || mediaReduced;
  const open = enabled && ui.drawerOpen;
  const pane = drawerPane(ui.pane, domain);
  const panes = drawerPanes(domain);
  const [settled, setSettled] = useState(false);
  const [glide, setGlide] = useState<GlideKind | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const buttons = useRef(new Map<RailButtonKey, HTMLButtonElement>());
  const { setDrawerOpen, setPane } = ui;

  // The stored choice comes in after mount (never during render, so the server and first client paint agree: closed).
  useEffect(() => {
    if (!enabled) return;
    const stored = readStoredDrawer();
    if (stored) {
      if (stored.open) setDrawerOpen(true);
      if (stored.open) setPane(drawerPane(stored.pane, domain));
    }
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true))) : 0;
    if (!frame) setSettled(true);
    return () => {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
    // Once: later changes are the viewer's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    // Only while the drawer exists: under 901px it is forced shut, and that must not overwrite the viewer's stored choice.
    if (!settled || !enabled) return;
    writeStoredDrawer({ open, pane });
  }, [open, pane, settled, enabled]);

  // The reflow window: from the frame the drawer toggles until its slide is over.
  const lastOpen = useRef(open);
  const pump = useRef(0);
  useEffect(() => () => cancelAnimationFrame(pump.current), []);
  useLayoutEffect(() => {
    if (lastOpen.current === open) return;
    lastOpen.current = open;
    if (!settled) return;
    const ms = reduced ? 0 : open ? DRAWER_IN_MS : DURATION.drawerOut;
    setGlide(reduced ? "none" : open ? "drawer-in" : "drawer-out");
    const start = performance.now();
    const tick = () => {
      dispatchReflowResize();
      if (performance.now() - start < ms + 40) pump.current = requestAnimationFrame(tick);
      else setGlide(null);
    };
    cancelAnimationFrame(pump.current);
    pump.current = requestAnimationFrame(tick);
  }, [open, reduced, settled]);

  // A real window resize moves the seats with the canvas, not behind it: no glide while it is being dragged.
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const onResize = () => {
      if (synthetic) return;
      setGlide((current) => current ?? "resize");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setGlide((current) => (current === "resize" ? null : current)), 180);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, [enabled]);

  const register = useCallback((key: RailButtonKey, element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(key, element);
    else buttons.current.delete(key);
  }, []);

  const close = useCallback(
    (restoreFocus = false) => {
      if (restoreFocus) buttons.current.get(pane)?.focus();
      setDrawerOpen(false);
    },
    [pane, setDrawerOpen],
  );

  const togglePane = useCallback(
    (next: SidePane) => {
      if (open && pane === next) {
        setDrawerOpen(false);
        return;
      }
      setPane(next);
      setDrawerOpen(true);
    },
    [open, pane, setDrawerOpen, setPane],
  );

  const toggleView = useCallback(() => setViewOpen((value) => !value), []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape" || !open || event.defaultPrevented) return;
      // The drawer owns this Escape: the camera's and the aim's must not also act on it.
      event.stopPropagation();
      event.preventDefault();
      close(true);
    },
    [close, open],
  );

  return { open, pane, panes, settled, glide, viewOpen, togglePane, toggleView, close, onKeyDown, register };
}
