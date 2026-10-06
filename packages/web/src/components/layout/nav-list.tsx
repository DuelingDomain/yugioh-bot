"use client";

import { useSandboxAccess } from "./use-sandbox-access";
import { FOOT_HREF, groupedNav, navItemByHref } from "./shell-model";
import { NavItem, type NavSize } from "./nav-item";
import { LiveNowRow } from "./live-now";
import type { LiveNow } from "./shell-model";
import styles from "./shell.module.css";

interface NavListProps {
  activeHref: string | null;
  label: string;
  size: NavSize;
  /** The Live now answer. The row shows under Dashboard when there is something live. */
  live?: LiveNow | null;
  onNavigate?: () => void;
}

/** The grouped main navigation: Dashboard, Live now (when live), Compete, Build. */
export function NavList({ activeHref, label, size, live = null, onNavigate }: NavListProps) {
  const isAdmin = useSandboxAccess();
  return (
    <nav className={styles.nav} aria-label={label} data-size={size}>
      {groupedNav(isAdmin).map((g, index) => (
        <div key={g.label ?? "top"} className={styles.navGroup}>
          {g.label ? (
            size === "rail" ? (
              <span className={styles.groupLine} aria-hidden="true" />
            ) : (
              <p className={styles.groupLabel}>{g.label}</p>
            )
          ) : null}
          {g.items.map((item) => (
            <NavItem key={item.href} item={item} active={item.href === activeHref} size={size} onNavigate={onNavigate} />
          ))}
          {index === 0 ? <LiveNowRow live={live} size={size} onNavigate={onNavigate} /> : null}
        </div>
      ))}
    </nav>
  );
}

export function SettingsLink({ activeHref, size, onNavigate }: Omit<NavListProps, "label" | "live">) {
  const item = navItemByHref(FOOT_HREF);
  if (!item) return null;
  return <NavItem item={item} active={item.href === activeHref} size={size} onNavigate={onNavigate} />;
}
