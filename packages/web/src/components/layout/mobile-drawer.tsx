"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { SheetPortal } from "@/components/sheet";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { NavList, SettingsLink } from "./nav-list";
import { activeNavHref } from "./shell-model";
import type { ShellAccount } from "./use-shell-account";
import styles from "./shell.module.css";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  account: ShellAccount;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [role="menuitem"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])';

function DrawerDialog({ onClose, account }: Omit<MobileDrawerProps, "open">) {
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
    <div className={styles.layer}>
      <div className={`ns-scrim ${styles.scrim}`} aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        className={`ns-drawer ${styles.drawer}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        onKeyDown={onKeyDown}
      >
        <div className="ns-brand">
          <BrandMark />
          <span className="ns-word">Duelists Kingdom</span>
          <button ref={closeRef} className="ns-ib" type="button" aria-label="Close menu" onClick={onClose}>
            <X className="ic" aria-hidden="true" />
          </button>
        </div>
        <NavList activeHref={activeHref} label="Mobile navigation" onNavigate={onClose} />
        <div className="ns-foot">
          <SettingsLink activeHref={activeHref} onNavigate={onClose} />
          <AccountMenu account={account} pathname={pathname} variant="side" onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}

/** Phone menu: a real dialog, mounted only while open. */
export function MobileDrawer({ open, onClose, account }: MobileDrawerProps) {
  // Locks page scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <SheetPortal>
      <DrawerDialog onClose={onClose} account={account} />
    </SheetPortal>
  );
}
