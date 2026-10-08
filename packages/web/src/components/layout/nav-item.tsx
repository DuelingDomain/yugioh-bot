"use client";

import Link from "next/link";
import { Tip } from "@/components/sheet";
import type { NavItem as NavEntry } from "@/lib/nav-items";
import styles from "./shell.module.css";

/**
 * The two sizes of the one nav item: the sidebar row (which is also the collapsed rail tile, drawn
 * by CSS from the same markup so the icon never moves) and the phone menu row.
 */
export type NavSize = "side" | "phone";

interface NavItemProps {
  item: NavEntry;
  active: boolean;
  size: NavSize;
  onNavigate?: () => void;
}

export function NavItem({ item, active, size, onNavigate }: NavItemProps) {
  const Icon = item.icon;
  const side = size === "side";
  const link = (
    <Link
      className={styles.navItem}
      data-size={size}
      data-active={active ? "true" : undefined}
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={side ? item.label : undefined}
      onClick={onNavigate}
    >
      {/* The sidebar's active fill and bar: one mark that glides between items (use-nav-glide.ts). */}
      {side && active ? <span className={styles.navMark} data-glide={item.href} aria-hidden="true" /> : null}
      <Icon className={styles.navIcon} aria-hidden="true" />
      <span className={styles.navLabel}>{item.label}</span>
    </Link>
  );
  // The tip only shows while the rail is collapsed (CSS); expanded, the row says it already.
  return side ? (
    <Tip label={item.label} side="right" className={styles.railTip}>
      {link}
    </Tip>
  ) : (
    link
  );
}
