"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { LightRule, SheetPortal } from "@/components/sheet";
import { DURATION, usePresence } from "@/lib/motion";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { NavList, SettingsLink } from "./nav-list";
import { activeNavHref, type LiveNow } from "./shell-model";
import type { ShellAccount } from "./use-shell-account";
import styles from "./shell.module.css";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  account: ShellAccount;
  live: LiveNow | null;
  onReportBug?: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [role="menuitem"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])';

function DrawerDialog({ onClose, account, live, onReportBug, state }: Omit<MobileDrawerProps, "open"> & { state: "open" | "closed" }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeHref = activeNavHref(pathname, account.playerId, account.profileSettled);

  // Focus moves to Close when the dialog mounts.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // An open account menu handles its own Escape first.
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const current = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (current === first || !dialogRef.current?.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !dialogRef.current?.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    // While it slides out the drawer is inert: focus has already gone back to the menu button.
    <div className={styles.layer} inert={state === "closed"}>
      <div className={styles.scrim} data-mo="scrim" data-state={state} aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        className={styles.drawer}
        data-mo="slide"
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        onKeyDown={onKeyDown}
      >
        <div className={styles.brand}>
          <BrandMark className={styles.mark} />
          <span className={styles.word}>Dueling <span className={styles.wordAccent}>Domain</span></span>
          <button ref={closeRef} className={styles.toggle} type="button" aria-label="Close menu" onClick={onClose}>
            <X className={styles.navIcon} aria-hidden="true" />
          </button>
        </div>
        <LightRule />
        <NavList activeHref={activeHref} label="Mobile navigation" size="phone" live={live} onNavigate={onClose} />
        <div className={styles.foot}>
          <SettingsLink activeHref={activeHref} size="phone" onNavigate={onClose} />
          <AccountMenu account={account} pathname={pathname} variant="side" onNavigate={onClose} onReportBug={onReportBug} />
        </div>
      </div>
    </div>
  );
}

/**
 * Phone menu: a real dialog, mounted while open and while it slides out. The scroll lock goes with
 * `open`, and the shell takes `inert` off the page and moves focus back as soon as `open` is false.
 */
export function MobileDrawer({ open, onClose, account, live, onReportBug }: MobileDrawerProps) {
  const { mounted, state } = usePresence(open, DURATION.drawerOut);
  // Locks page scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted) return null;
  return (
    <SheetPortal>
      <DrawerDialog onClose={onClose} account={account} live={live} onReportBug={onReportBug} state={state} />
    </SheetPortal>
  );
}
