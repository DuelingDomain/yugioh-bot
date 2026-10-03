"use client";

import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { LightRule, SheetRoot, Tip } from "@/components/sheet";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { NavList, SettingsLink } from "./nav-list";
import { activeNavHref, type LiveNow } from "./shell-model";
import type { ShellAccount } from "./use-shell-account";
import styles from "./shell.module.css";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  account: ShellAccount;
  live: LiveNow | null;
}

/** Desktop sidebar. Hidden by the shell's CSS at phone width, where the top bar and menu take over. */
export function Sidebar({ collapsed, onToggle, account, live }: SidebarProps) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname, account.playerId, account.profileSettled);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const size = collapsed ? "rail" : "side";

  const toggle = (
    <button className={styles.toggle} type="button" aria-label={label} aria-expanded={!collapsed} title={collapsed ? undefined : label} onClick={onToggle}>
      <PanelLeft className={styles.navIcon} aria-hidden="true" />
    </button>
  );

  return (
    <SheetRoot flow className={styles.side} data-collapsed={collapsed ? "true" : "false"}>
      <aside className={styles.aside} aria-label="Sidebar" data-rail={collapsed ? "true" : undefined}>
        <div className={styles.brand}>
          <BrandMark className={styles.mark} />
          {collapsed ? null : <span className={styles.word}>Duelists Kingdom</span>}
          {collapsed ? null : toggle}
        </div>
        <LightRule />
        {collapsed ? (
          <div className={styles.railToggle}>
            <Tip label={label} side="right" className={styles.railTip}>
              {toggle}
            </Tip>
          </div>
        ) : null}
        <NavList activeHref={activeHref} label="Main navigation" size={size} live={live} />
        <div className={styles.foot}>
          <SettingsLink activeHref={activeHref} size={size} />
          <AccountMenu account={account} pathname={pathname} variant="side" rail={collapsed} />
        </div>
      </aside>
    </SheetRoot>
  );
}
