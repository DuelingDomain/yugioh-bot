"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { LightRule, SheetRoot, Tip } from "@/components/sheet";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { LegalLinks } from "./legal-links";
import { NavList, SettingsLink } from "./nav-list";
import { activeNavHref, type LiveNow } from "./shell-model";
import { useNavGlide } from "./use-nav-glide";
import type { ShellAccount } from "./use-shell-account";
import styles from "./shell.module.css";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  account: ShellAccount;
  live: LiveNow | null;
  onReportBug?: () => void;
}

/**
 * Desktop sidebar. Hidden by the shell's CSS at phone width, where the top bar and menu take over.
 *
 * Expanded and collapsed are the same markup: collapsing only narrows the rail and fades the text,
 * so every icon keeps its place (CSS in shell.module.css; the shell turns the transitions on).
 * The toggle exists twice, in the brand row and in the rail, and they cross-fade.
 */
export function Sidebar({ collapsed, onToggle, account, live, onReportBug }: SidebarProps) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname, account.playerId, account.profileSettled);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const asideRef = useRef<HTMLElement>(null);
  const sideToggle = useRef<HTMLButtonElement>(null);
  const railToggle = useRef<HTMLButtonElement>(null);
  const wasCollapsed = useRef(collapsed);
  useNavGlide(asideRef, activeHref);

  // The toggle that was just used goes away; focus moves to its twin so keyboard users keep their place.
  // A mouse click lets focus drop instead: the twin's tip would otherwise pop up with no pointer on it.
  useLayoutEffect(() => {
    if (wasCollapsed.current === collapsed) return;
    wasCollapsed.current = collapsed;
    const gone = collapsed ? sideToggle.current : railToggle.current;
    if (gone && document.activeElement === gone && gone.matches(":focus-visible")) (collapsed ? railToggle : sideToggle).current?.focus({ preventScroll: true });
  }, [collapsed]);

  const toggle = (which: "side" | "rail", visible: boolean) => (
    <button
      ref={which === "side" ? sideToggle : railToggle}
      className={styles.toggle}
      data-for={which}
      type="button"
      aria-label={label}
      aria-expanded={!collapsed}
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      title={which === "side" && visible ? label : undefined}
      onClick={onToggle}
    >
      <PanelLeft className={styles.navIcon} aria-hidden="true" />
    </button>
  );

  return (
    <SheetRoot flow className={styles.side} data-collapsed={collapsed ? "true" : "false"}>
      <aside ref={asideRef} className={styles.aside} aria-label="Sidebar" data-rail={collapsed ? "true" : undefined}>
        <div className={styles.brand}>
          <BrandMark className={styles.mark} />
          <span className={styles.word}>Dueling <span className={styles.wordAccent}>Domain</span></span>
          {toggle("side", !collapsed)}
        </div>
        <LightRule />
        <div className={styles.railToggle}>
          <div className={styles.railToggleClip}>
            <div className={styles.railToggleRow}>
              <Tip label={label} side="right" className={styles.railTip}>
                {toggle("rail", collapsed)}
              </Tip>
            </div>
          </div>
        </div>
        <NavList activeHref={activeHref} label="Main navigation" size="side" live={live} isAdmin={account.isAdmin} />
        <div className={styles.foot}>
          <SettingsLink activeHref={activeHref} size="side" />
          <AccountMenu account={account} pathname={pathname} variant="side" rail={collapsed} onReportBug={onReportBug} />
          <div className={styles.footLegal}>
            <LegalLinks />
          </div>
        </div>
      </aside>
    </SheetRoot>
  );
}
