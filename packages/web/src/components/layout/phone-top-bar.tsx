"use client";

import { forwardRef } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { LiveDot, SheetRoot } from "@/components/sheet";
import { AccountMenu } from "./account-menu";
import { pageTitle, type LiveNow } from "./shell-model";
import type { ShellAccount } from "./use-shell-account";
import styles from "./shell.module.css";

interface PhoneTopBarProps {
  account: ShellAccount;
  menuOpen: boolean;
  live: LiveNow | null;
  onMenuClick: (trigger: HTMLElement | null) => void;
}

/** 56px bar shown at phone width only: menu (with the Live dot), page title, your ring. */
export const PhoneTopBar = forwardRef<HTMLButtonElement, PhoneTopBarProps>(function PhoneTopBar(
  { account, menuOpen, live, onMenuClick },
  menuButtonRef,
) {
  const pathname = usePathname();
  const anyLive = Boolean(live && (live.yourDuel || live.liveCount > 0));
  return (
    <SheetRoot flow className={styles.topWrap}>
      <header className={styles.topBar}>
        <button
          ref={menuButtonRef}
          className={styles.menuButton}
          data-bare="true"
          type="button"
          aria-label={anyLive ? "Open menu, live now" : "Open menu"}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={(e) => onMenuClick(e.currentTarget)}
        >
          <Menu className={styles.menuIcon} aria-hidden="true" />
          {anyLive ? (
            <span className={styles.menuDot} aria-hidden="true">
              <LiveDot you={Boolean(live?.yourDuel)} />
            </span>
          ) : null}
        </button>
        <p className={styles.topTitle}>{pageTitle(pathname, account.playerId)}</p>
        <AccountMenu account={account} pathname={pathname} variant="phone" />
      </header>
    </SheetRoot>
  );
});
