"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { PhoneTopBar } from "./phone-top-bar";
import { MobileDrawer } from "./mobile-drawer";
import { BugReportDialog } from "../bug-report/bug-report-dialog";
import { BugReportFab } from "../bug-report/bug-report-fab";
import { collectBugContext } from "../bug-report/context";
import { useShellAccount } from "./use-shell-account";
import { PHONE_MAX_WIDTH } from "./shell-model";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const pathname = usePathname();
  const account = useShellAccount();

  // A page change (including the back button) closes the phone menu.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Read after mount so the server render and the first client render agree.
  useEffect(() => {
    setSidebarCollapsed(readCollapsed());
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openReport = useCallback(() => setReportOpen(true), []);
  const closeReport = useCallback(() => setReportOpen(false), []);
  // A page report has no room: the path and the browser details only.
  const collectPage = useCallback(() => collectBugContext(null), []);

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
    if (wasOpen.current && !drawerOpen) menuButtonRef.current?.focus();
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);

  return (
    <>
      <div
        ref={frameRef}
        className={`${styles.frame} min-h-screen bg-bg-deep text-text-primary`}
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      >
        <PhoneTopBar ref={menuButtonRef} account={account} menuOpen={drawerOpen} onMenuClick={() => setDrawerOpen(true)} onReportBug={openReport} />
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} account={account} onReportBug={openReport} />
        <main className={styles.main}>
          <div className="mx-auto p-4 pb-16 sm:p-6 sm:pb-16 lg:p-8 lg:pb-16">{children}</div>
        </main>
        <BugReportFab className={`fixed bottom-3 z-40 ${styles.bugFab}`} />
      </div>
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} account={account} onReportBug={openReport} />
      <BugReportDialog open={reportOpen} onClose={closeReport} collect={collectPage} />
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Keep the field's inspector and Domain rail usable instead of squeezing them
  // beside the dashboard navigation. The room includes its own route back.
  if (pathname.startsWith("/duels/")) {
    return (
      <>
        <main className="min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8">{children}</main>
        <BugReportFab />
      </>
    );
  }

  // The deck editor is a full-screen, three-pane workspace with its own route back.
  if (pathname === "/decks/new" || /^\/decks\/\d+$/.test(pathname)) {
    return (
      <>
        <main className="min-h-screen bg-bg-deep text-text-primary">{children}</main>
        <BugReportFab />
      </>
    );
  }

  return <ShellFrame>{children}</ShellFrame>;
}
