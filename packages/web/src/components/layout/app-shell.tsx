"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { PhoneTopBar } from "./phone-top-bar";
import { MobileDrawer } from "./mobile-drawer";
import { useShellAccount } from "./use-shell-account";
import { useLiveNow } from "./use-live-now";
import { ShellContext } from "./shell-context";
import { PHONE_MAX_WIDTH, ROOM_COLLAPSE_QUERY, autoCollapseRoute } from "./shell-model";
import styles from "./shell.module.css";

const COLLAPSED_KEY = "yugidraft:sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Storage can be blocked; the choice then lasts for this visit only.
  }
}

function ShellFrame({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stored, setStored] = useState(false);
  // On the tournament page, between 1024 and 1360px, the rail starts collapsed. The toggle then
  // flips a per-visit override that is not written to storage and resets on the next route.
  const [override, setOverride] = useState<boolean | null>(null);
  const [roomWidth, setRoomWidth] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const pathname = usePathname();
  const account = useShellAccount();
  const live = useLiveNow(pathname);
  const autoCollapsed = roomWidth && autoCollapseRoute(pathname);
  const sidebarCollapsed = override ?? (autoCollapsed || stored);

  // A page change (including the back button) closes the phone menu.
  useEffect(() => {
    setDrawerOpen(false);
    setOverride(null);
  }, [pathname]);

  // Read after mount so the server render and the first client render agree.
  useEffect(() => {
    setStored(readCollapsed());
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.(ROOM_COLLAPSE_QUERY);
    if (!mq) return;
    const onChange = () => setRoomWidth(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (autoCollapsed || override !== null) {
      // A page that collapses itself: the toggle is for this visit only.
      setOverride(!sidebarCollapsed);
      return;
    }
    writeCollapsed(!stored);
    setStored(!stored);
  }, [autoCollapsed, override, sidebarCollapsed, stored]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openMenu = useCallback((trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    setDrawerOpen(true);
  }, []);
  const shell = useMemo(() => ({ openMenu, menuOpen: drawerOpen, live }), [openMenu, drawerOpen, live]);

  // Close the phone menu when the window grows past phone width.
  useEffect(() => {
    if (!drawerOpen) return;
    const mq = window.matchMedia?.(`(min-width: ${PHONE_MAX_WIDTH + 1}px)`);
    if (!mq) return;
    const onChange = () => {
      if (mq.matches) setDrawerOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [drawerOpen]);

  // The page behind the dialog can't be reached; focus returns to the menu button.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame) frame.inert = drawerOpen;
    if (wasOpen.current && !drawerOpen) {
      const target = triggerRef.current?.isConnected ? triggerRef.current : menuButtonRef.current;
      target?.focus();
    }
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);

  return (
    <ShellContext.Provider value={shell}>
      <div
        ref={frameRef}
        className={`${styles.frame} min-h-screen bg-bg-deep text-text-primary`}
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      >
        <PhoneTopBar ref={menuButtonRef} account={account} menuOpen={drawerOpen} live={live} onMenuClick={openMenu} />
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} account={account} live={live} />
        <main className={styles.main}>
          <div className={`${styles.content} mx-auto p-4 sm:p-6 lg:p-8`}>{children}</div>
        </main>
      </div>
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} account={account} live={live} />
    </ShellContext.Provider>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Keep the field's inspector and Domain rail usable instead of squeezing them
  // beside the dashboard navigation. The room includes its own route back.
  if (pathname.startsWith("/duels/")) {
    return <main className="min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8">{children}</main>;
  }

  // The deck editor is a full-screen, three-pane workspace with its own route back.
  if (pathname === "/decks/new" || /^\/decks\/\d+$/.test(pathname)) {
    return <main className="min-h-screen bg-bg-deep text-text-primary">{children}</main>;
  }

  return <ShellFrame>{children}</ShellFrame>;
}
