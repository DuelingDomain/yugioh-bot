"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { EdgeTab, type EdgeSide, type EdgeTone } from "./edge-tab";
import styles from "./edge-drawer.module.css";

/** What opened the drawer. Hover opening never takes focus and never traps it; the others do. */
export type OpenVia = "hover" | "click" | "key" | "api";

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
  /** Open when a mouse or pen rests on the tab, and close when it leaves. Default true. Touch never hover-opens. */
  hoverOpen?: boolean;
  hoverDelayMs?: number;
  hoverCloseMs?: number;
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

/** How long a tab ignores hover after the drawer was closed on purpose (key, click, outside press, tab). */
const HOVER_QUIET_MS = 800;

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function typingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/**
 * A slide-out for side content (Deck Master, duel log, chat, card inspect). Closed by default, so nothing
 * covers the field in normal play; only the small edge tab shows, and it glows when `attention` is set.
 * It opens from the tab (click, Enter, Space, or hover with a mouse), from the optional shortcut key, or
 * from the parent through `open`. While open it may overlay the field. It closes on Escape, on a press
 * outside, or from the tab, and then slides back (a short fade under reduced motion).
 *
 * Focus: opening by click, key or the parent moves focus into the panel and traps Tab inside it; closing
 * gives focus back to the tab. Opening by hover does neither, until a click pins it.
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
  hoverOpen = true,
  hoverDelayMs = 140,
  hoverCloseMs = 280,
  closeOnOutside = true,
  closeOnEscape = true,
  size,
  tabOffset,
  fixed = false,
  className,
  panelClassName,
}: EdgeDrawerProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const [via, setVia] = useState<OpenVia>("api");
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;
  const restoreFocusRef = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After a close the tab slides back under a pointer that rests where the drawer was; that must not count as a new hover.
  const noHoverUntil = useRef(0);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const openRef = useRef(open);
  openRef.current = open;
  const viaRef = useRef(via);
  viaRef.current = via;

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);

  const request = useCallback(
    (next: boolean, how: OpenVia, restoreFocus = true) => {
      clearHover();
      if (next === openRef.current && (!next || how === viaRef.current || how === "hover")) return;
      if (next) {
        restoreFocusRef.current = false;
        setVia(how);
      } else {
        restoreFocusRef.current = restoreFocus && (panelRef.current?.contains(document.activeElement) ?? false);
      }
      if (!controlled) setInnerOpen(next);
      onOpenChangeRef.current?.(next, how);
    },
    [clearHover, controlled],
  );

  // Whoever closes the drawer (the tab, Escape, a press outside, or the parent), a pointer resting where it was must not reopen it.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && viaRef.current !== "hover") noHoverUntil.current = Date.now() + HOVER_QUIET_MS;
    wasOpen.current = open;
  }, [open]);

  // A drawer opened by the parent (controlled `open` flipping true with no request) counts as "api".
  // A closed drawer forgets how it was opened.
  useEffect(() => {
    if (!open) setVia("api");
  }, [open]);

  useEffect(() => clearHover, [clearHover]);

  // Give focus back to the tab after a close that left focus inside the panel.
  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    tabRef.current?.focus();
  }, [open]);

  // Move focus into the panel for every opening except hover (and again when a click pins a hover opening).
  useEffect(() => {
    if (!open || via === "hover") return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const first = panel.querySelector<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    (first ?? panel).focus({ preventScroll: true });
  }, [open, via]);

  useFocusTrap(panelRef, open && via !== "hover");

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

  const onTabClick = (event: { detail: number }) => {
    // Hover-opened + click = pin it (stay open, take focus). Open + click = close.
    if (open && via === "hover") request(true, "click");
    else request(!open, event.detail === 0 ? "key" : "click");
  };

  const mouseLike = (event: ReactPointerEvent) => event.pointerType !== "touch";
  const onTabEnter = (event: ReactPointerEvent) => {
    if (!hoverOpen || !mouseLike(event) || openRef.current || Date.now() < noHoverUntil.current) return;
    clearHover();
    hoverTimer.current = setTimeout(() => request(true, "hover"), hoverDelayMs);
  };
  const onLeave = (event: ReactPointerEvent) => {
    if (!hoverOpen || !mouseLike(event)) return;
    clearHover();
    if (!openRef.current) return;
    // Only a hover opening closes by leaving; a pinned drawer waits for Escape, an outside press or the tab.
    hoverTimer.current = setTimeout(() => {
      if (viaRef.current === "hover") request(false, "hover");
    }, hoverCloseMs);
  };
  const onEnterKeep = (event: ReactPointerEvent) => {
    if (mouseLike(event)) clearHover();
  };

  const style: CSSProperties = {};
  if (size) (style as Record<string, string>)["--bf-drawer-size"] = size;
  if (tabOffset) (style as Record<string, string>)["--bf-tab-offset"] = tabOffset;

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
        <div className={styles.tabSlot} onPointerLeave={onLeave} onPointerEnter={onTabEnter}>
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
          onPointerEnter={onEnterKeep}
          onPointerLeave={onLeave}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
