"use client";

import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { SheetRoot } from "@/components/sheet";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { NavList, SettingsLink } from "./nav-list";
import { activeNavHref } from "./shell-model";
import type { ShellAccount } from "./use-shell-account";
import styles from "./shell.module.css";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  account: ShellAccount;
}

/** Desktop sidebar. Hidden by the shell's CSS at phone width, where the top bar and menu take over. */
export function Sidebar({ collapsed, onToggle, account }: SidebarProps) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname, account.playerId, account.profileSettled);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <SheetRoot flow className={styles.side} data-collapsed={collapsed ? "true" : "false"}>
      <div className={`ns ${styles.nsWrap}`} data-c={collapsed ? "" : undefined}>
        <aside className="ns-side" aria-label="Sidebar">
          <div className="ns-brand">
            <BrandMark />
            <span className="ns-word">YugiDraft</span>
            <button className="ns-ib" type="button" aria-label={label} title={label} aria-expanded={!collapsed} onClick={onToggle}>
              <PanelLeft className="ic" aria-hidden="true" />
            </button>
          </div>
          <NavList activeHref={activeHref} label="Main navigation" collapsed={collapsed} />
          <div className="ns-foot">
            <SettingsLink activeHref={activeHref} collapsed={collapsed} />
            <AccountMenu account={account} pathname={pathname} variant="side" />
          </div>
        </aside>
      </div>
    </SheetRoot>
  );
}
