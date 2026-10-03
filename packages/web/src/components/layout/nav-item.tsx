"use client";

import Link from "next/link";
import { Tip } from "@/components/sheet";
import type { NavItem as NavEntry } from "@/lib/nav-items";
import styles from "./shell.module.css";

/** The three sizes of the one nav item: the sidebar row, the collapsed rail tile, the phone menu row. */
export type NavSize = "side" | "rail" | "phone";

interface NavItemProps {
  item: NavEntry;
  active: boolean;
  size: NavSize;
  onNavigate?: () => void;
}

export function NavItem({ item, active, size, onNavigate }: NavItemProps) {
  const Icon = item.icon;
  const rail = size === "rail";
  const link = (
    <Link
      className={styles.navItem}
      data-size={size}
      data-active={active ? "true" : undefined}
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? item.label : undefined}
      onClick={onNavigate}
    >
      <Icon className={styles.navIcon} aria-hidden="true" />
      {rail ? null : <span className={styles.navLabel}>{item.label}</span>}
    </Link>
  );
  return rail ? (
    <Tip label={item.label} side="right" className={styles.railTip}>
      {link}
    </Tip>
  ) : (
    link
  );
}
