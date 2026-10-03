"use client";

import { forwardRef } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { SheetRoot } from "@/components/sheet";
import { AccountMenu } from "./account-menu";
import { pageTitle } from "./shell-model";
import type { ShellAccount } from "./use-shell-account";
import styles from "./shell.module.css";

interface PhoneTopBarProps {
  account: ShellAccount;
  menuOpen: boolean;
  onMenuClick: () => void;
  onReportBug?: () => void;
}

/** 56px bar shown at phone width only: menu, page title, avatar. */
export const PhoneTopBar = forwardRef<HTMLButtonElement, PhoneTopBarProps>(function PhoneTopBar(
  { account, menuOpen, onMenuClick, onReportBug },
  menuButtonRef,
) {
  const pathname = usePathname();
  return (
    <SheetRoot flow className={styles.topWrap}>
      <header className="ns-top">
        <button
          ref={menuButtonRef}
          className="ns-ib"
          type="button"
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={onMenuClick}
        >
          <Menu className="ic" aria-hidden="true" />
        </button>
        <p className="ns-title">{pageTitle(pathname, account.playerId)}</p>
        <AccountMenu account={account} pathname={pathname} variant="phone" onReportBug={onReportBug} />
      </header>
    </SheetRoot>
  );
});
