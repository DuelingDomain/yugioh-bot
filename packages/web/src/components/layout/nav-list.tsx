"use client";

import Link from "next/link";
import type { NavItem } from "@/lib/nav-items";
import { FOOT_HREF, groupedNav, navItemByHref } from "./shell-model";

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  /** Collapsed rail: the label is hidden, so the link keeps its name and shows a tooltip. */
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavLink({ item, active, collapsed, onNavigate }: NavLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      className="ns-i"
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      onClick={onNavigate}
    >
      <Icon className="ic" aria-hidden="true" />
      <span className="ns-l">{item.label}</span>
      {collapsed ? (
        <span className="ns-tip" role="tooltip">
          {item.label}
        </span>
      ) : null}
    </Link>
  );
}

interface NavListProps {
  activeHref: string | null;
  label: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}

/** The grouped main navigation: Dashboard, Compete, Build. */
export function NavList({ activeHref, label, collapsed, onNavigate }: NavListProps) {
  return (
    <nav className="ns-nav" aria-label={label}>
      {groupedNav().map((g) => (
        <div key={g.label ?? "top"} style={{ display: "contents" }}>
          {g.label ? <p className="ns-g">{g.label}</p> : null}
          {g.items.map((item) => (
            <NavLink key={item.href} item={item} active={item.href === activeHref} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export function SettingsLink({ activeHref, collapsed, onNavigate }: Omit<NavListProps, "label">) {
  const item = navItemByHref(FOOT_HREF);
  if (!item) return null;
  return <NavLink item={item} active={item.href === activeHref} collapsed={collapsed} onNavigate={onNavigate} />;
}
