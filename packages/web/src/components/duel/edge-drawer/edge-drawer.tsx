"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { EdgeTab, type EdgeSide, type EdgeTone } from "./edge-tab";
import styles from "./edge-drawer.module.css";

/** What opened the drawer: a click on the tab, a key (Enter, Space or the shortcut), or the parent. Never a hover. */
export type OpenVia = "click" | "key" | "api";

export interface EdgeDrawerProps {
  side: EdgeSide;
  /** Tab text and the panel's accessible name. */
  label: string;
  icon?: ReactNode;
  /** Something new or important is behind the drawer: the tab glows. */
  attention?: boolean;
  /** New-item count on the tab badge. */
  count?: number;
  tone?: EdgeTone;
  children: ReactNode;

  /** Controlled state. Leave out for an uncontrolled drawer that starts closed. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, via: OpenVia) => void;

  /** A single key (for example "l") that toggles the drawer. Ignored while typing and with Ctrl, Alt or Meta. */
  shortcut?: string;
  /** Close on a press outside the drawer. Default true. The press still reaches whatever it hit. */
  closeOnOutside?: boolean;
  /** Close on Escape. Default true. */
  closeOnEscape?: boolean;

  /** Panel width (left/right) or height (bottom): any CSS length. */
  size?: string;
  /** Where the tab sits along the edge: any CSS length or percent. Stack several tabs on one edge with this. */
  tabOffset?: string;
  /** Use viewport positioning instead of the nearest positioned ancestor. */
  fixed?: boolean;
  className?: string;
  panelClassName?: string;
}

/** True while any edge drawer is open. Escape handlers elsewhere in the duel screen (camera, Yes/No pre-check) use it to step aside. */
export function anyEdgeDrawerOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector('[data-edge-drawer][data-state="open"]') !== null;
}

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function typingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/** The panel size when a drawer sets none (the same fallbacks as edge-drawer.module.css). */
const DEFAULT_SIZE: Record<EdgeSide, string> = { left: "min(360px, 88vw)", right: "min(360px, 88vw)", bottom: "min(320px, 58dvh)" };
/** Room that stays free on a narrow screen, so the tabs beside an open panel never leave it (a 36px touch tab and a margin). */
const TAB_COLUMN = "48px";
const clampSize = (size: string, side: EdgeSide) => (side === "bottom" ? size : `min(${size}, calc(100vw - ${TAB_COLUMN}))`);

/**
 * Which drawer of each screen edge is open, and how wide. A closed drawer reads it to move its tab to the outer face of
 * the open panel: the tabs of one edge always stay in view and never lie over the open drawer's content.
 */
const openByEdge: Record<EdgeSide, Array<{ id: string; size: string }>> = { left: [], right: [], bottom: [] };
const edgeListeners = new Set<() => void>();
const subscribeEdges = (listener: () => void) => {
  edgeListeners.add(listener);
  return () => { edgeListeners.delete(listener); };
};
function markOpen(side: EdgeSide, id: string, size: string | null) {
  const list = openByEdge[side].filter((entry) => entry.id !== id);
  if (size != null) list.push({ id, size });
  openByEdge[side] = list;
  edgeListeners.forEach((listener) => listener());
}
const openSizeOf = (side: EdgeSide): string => openByEdge[side][openByEdge[side].length - 1]?.size ?? "";

/** The tabs of one edge, in screen order (top to bottom, or left to right on the bottom edge). */
function tabsOnEdge(side: EdgeSide): HTMLElement[] {
  const tabs = [...document.querySelectorAll<HTMLElement>(`[data-edge-tab][data-side="${side}"]`)];
  const key = (node: HTMLElement) => { const box = node.getBoundingClientRect(); return side === "bottom" ? box.left : box.top; };
  return tabs.sort((a, b) => key(a) - key(b));
}

/**
 * A slide-out for side content (duel log, settings, chain, card inspect). Closed by default, so nothing
 * covers the field in normal play; only the small edge tab shows, and it glows when `attention` is set.
 * It opens only from a click on its tab (Enter or Space on the focused tab count), from the optional shortcut
 * key, or from the parent through `open`. A resting pointer or a focus change never opens it. While open it may
 * overlay the field. It closes on Escape, on a press outside, or from its own tab, and then slides back
 * (a short fade under reduced motion).
 *
 * Tabs: the tab of a closed drawer moves to the outer face of whichever drawer is open on the same edge, so
 * every tab stays visible and clickable, and a click on another tab switches to that drawer. The tab never lies
 * over the open panel. Up and Down arrows (Left and Right on the bottom edge) move focus between the tabs of an edge.
 *
 * Focus: opening moves focus into the panel; Shift+Tab goes back to the tab, and the tabs stay reachable (the
 * panel is not modal). Closing from inside the panel gives focus back to the tab.
 */
export function EdgeDrawer({
  side,
  label,
  icon,
  attention,
  count,
  tone,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  shortcut,
  closeOnOutside = true,
  closeOnEscape = true,
  size,
  tabOffset,
  fixed = false,
  className,
  panelClassName,
}: EdgeDrawerProps) {
  const panelId = useId();
  const markId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;
  // Focus is inside the panel. It stays true through a close (the browser drops focus from the panel then), so the tab can take it back,
  // whoever closed the drawer (this component's Escape, the shell's Escape, the panel's close button).
  const focusInsideRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const openRef = useRef(open);
  openRef.current = open;

  const request = useCallback(
    (next: boolean, how: OpenVia, restoreFocus = true) => {
      if (next === openRef.current) return;
      if (!next && !restoreFocus) focusInsideRef.current = false;
      if (!controlled) setInnerOpen(next);
      onOpenChangeRef.current?.(next, how);
    },
    [controlled],
  );

  // Tell the other drawers of this edge that this one is open and how wide, so their tabs stand on its outer face.
  const panelSize = size ?? DEFAULT_SIZE[side];
  useEffect(() => {
    if (!open) return;
    markOpen(side, markId, panelSize);
    return () => markOpen(side, markId, null);
  }, [open, side, markId, panelSize]);
  const openSize = useSyncExternalStore(subscribeEdges, () => openSizeOf(side), () => "");

  // Give focus back to the tab after a close that left focus inside the panel.
  useEffect(() => {
    if (open || !focusInsideRef.current) return;
    focusInsideRef.current = false;
    tabRef.current?.focus();
  }, [open]);

  // Move focus into the panel when it opens (a click on the tab, a key, or the parent). The panel is made focusable by the same commit
  // (`inert` off, `visibility` back), but the browser refuses focus on content whose style is still settling (a descendant with a
  // transition on `visibility`), so the try repeats for a few frames until the focus lands.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let tries = 0;
    const focusIn = () => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const first = panel.querySelector<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (first ?? panel).focus({ preventScroll: true });
      if (!panel.contains(document.activeElement) && (tries += 1) < 12) frame = requestAnimationFrame(focusIn);
    };
    frame = requestAnimationFrame(focusIn);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape && !event.defaultPrevented) {
        // Mark it handled, so a later Escape listener that checks `defaultPrevented` (or `anyEdgeDrawerOpen`) lets it go.
        event.preventDefault();
        request(false, "key");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, request]);

  useEffect(() => {
    if (!open || !closeOnOutside) return;
    const onDown = (event: PointerEvent) => {
      // A press on the tab of another drawer is a switch, not an outside press: that click closes this drawer and opens the other.
      if (event.target instanceof Element && event.target.closest("[data-edge-drawer]")) return;
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) request(false, "click", false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, closeOnOutside, request]);

  useEffect(() => {
    if (!shortcut) return;
    const want = shortcut.toLowerCase();
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
      if (event.key?.toLowerCase() !== want || typingTarget(event.target)) return;
      // A modal dialog (the bug report, a confirm) owns the keyboard while it is open.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      request(!openRef.current, "key");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut, request]);

  // A click on the tab toggles: it opens a closed drawer and closes its own open one. `detail` 0 is Enter or Space.
  const onTabClick = (event: { detail: number }) => request(!open, event.detail === 0 ? "key" : "click");

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const vertical = side !== "bottom";
    const step = event.key === (vertical ? "ArrowDown" : "ArrowRight") ? 1 : event.key === (vertical ? "ArrowUp" : "ArrowLeft") ? -1 : 0;
    const edge = event.key === "Home" ? 0 : event.key === "End" ? -1 : null;
    if (step === 0 && edge === null) return;
    const tabs = tabsOnEdge(side);
    const at = tabs.indexOf(event.currentTarget);
    if (at < 0 || tabs.length < 2) return;
    event.preventDefault();
    const next = edge === null ? tabs[(at + step + tabs.length) % tabs.length] : tabs[edge < 0 ? tabs.length - 1 : 0];
    next.focus();
  };

  const style: CSSProperties = {};
  if (size) (style as Record<string, string>)["--bf-drawer-size"] = size;
  if (tabOffset) (style as Record<string, string>)["--bf-tab-offset"] = tabOffset;
  // A closed drawer's tab stands on the outer face of the panel that is open on this edge.
  if (!open && openSize) (style as Record<string, string>)["--bf-shift"] = clampSize(openSize, side);

  return (
    <div
      ref={rootRef}
      className={className ? `${styles.root} ${className}` : styles.root}
      style={style}
      data-side={side}
      data-state={open ? "open" : "closed"}
      data-fixed={fixed ? "true" : undefined}
      data-edge-drawer={label}
    >
      <div className={styles.slide}>
        <div className={styles.tabSlot}>
          <EdgeTab
            ref={tabRef}
            side={side}
            label={label}
            icon={icon}
            attention={attention}
            count={count}
            tone={tone}
            open={open}
            controlsId={panelId}
            onClick={onTabClick}
            onKeyDown={onTabKeyDown}
          />
        </div>
        <div
          ref={panelRef}
          id={panelId}
          className={panelClassName ? `${styles.panel} ${panelClassName}` : styles.panel}
          role="dialog"
          aria-modal="false"
          aria-label={label}
          aria-hidden={open ? undefined : true}
          // `inert` keeps a closed panel out of the tab order and away from screen readers.
          inert={!open}
          tabIndex={-1}
          onFocus={() => { focusInsideRef.current = true; }}
          // A blur while the drawer is open means focus went elsewhere on purpose; the blur of a close does not count.
          onBlur={() => { if (openRef.current) focusInsideRef.current = false; }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
