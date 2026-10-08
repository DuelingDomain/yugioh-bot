"use client";

import { Crown, FileText, ScrollText, Settings, Video, X, type LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import baseRoomStyles from "../room.module.css";
import { SIDE_PANE_LABEL, SidePanel, SideTabs, unreadLabel, type SidePane } from "../side-panel";
import { cardScrollerProps } from "../inspector";
import { useSkinStyles } from "../skin";
import styles from "./table-rail.module.css";

/** The id the rail buttons point at (aria-controls) and the drawer carries. */
export const DRAWER_ID = "duel-table-drawer";

/** The tabs of the wide table's drawer: Master only exists in a Domain duel. */
export function drawerPanes(domain: boolean): readonly SidePane[] {
  return domain ? ["card", "log", "masters", "settings"] : ["card", "log", "settings"];
}

/** A pane the drawer can show. Deck Masters are a tab only in a Domain duel. */
export function drawerPane(pane: SidePane, domain: boolean): SidePane {
  return pane === "masters" && !domain ? "card" : pane;
}

const ICONS: Record<SidePane, LucideIcon> = {
  card: FileText,
  log: ScrollText,
  masters: Crown,
  settings: Settings,
};

/** The name a rail button and the Master tab share. */
const RAIL_LABEL: Record<SidePane, string> = { ...SIDE_PANE_LABEL, masters: "Master" };

export type RailButtonKey = SidePane | "view";

export interface TableRailProps {
  panes: readonly SidePane[];
  /** The pane the drawer shows (or would show). */
  pane: SidePane;
  open: boolean;
  /** New log rows since the Log tab was in view. */
  unread: number;
  /** The camera View grid is open. */
  viewOpen: boolean;
  /** The last moves, as a column of tiles. */
  history: ReactNode;
  onPane: (pane: SidePane) => void;
  onView: () => void;
  /** The buttons register here, so the shell can give focus back to the one that opened the drawer. */
  register: (key: RailButtonKey, element: HTMLButtonElement | null) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The wide table's 72px rail: the last moves, one button per drawer pane (Card, Log, Master, Settings) and the camera
 * View. A pane's button opens the drawer on it; the open pane's button closes it. The rail never moves.
 */
export function TableRail({ panes, pane, open, unread, viewOpen, history, onPane, onView, register, onKeyDown }: TableRailProps) {
  return (
    <nav className={styles.rail} aria-label="Table panels" data-testid="table-rail" data-table-chrome="" onKeyDown={onKeyDown}>
      {history}
      <div className={styles.group}>
        {panes.map((tab) => {
          const Icon = ICONS[tab];
          const active = open && pane === tab;
          return (
            <button
              key={tab}
              type="button"
              ref={(element) => register(tab, element)}
              className={styles.button}
              data-rail={tab}
              data-active={active ? "true" : undefined}
              aria-expanded={active}
              aria-controls={DRAWER_ID}
              onClick={() => onPane(tab)}
            >
              <Icon size={19} strokeWidth={1.6} aria-hidden />
              <span>{RAIL_LABEL[tab]}</span>
              {tab === "log" && unread > 0 ? (
                <>
                  <i className={styles.badge} data-testid="rail-log-unread" aria-hidden="true">{unreadLabel(unread)}</i>
                  <span className="sr-only">, {unread} new {unread === 1 ? "event" : "events"}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        ref={(element) => register("view", element)}
        className={`${styles.button} ${styles.view}`}
        data-rail="view"
        data-active={viewOpen ? "true" : undefined}
        aria-expanded={viewOpen}
        aria-controls="camera-view-grid"
        onClick={onView}
      >
        <Video size={19} strokeWidth={1.6} aria-hidden />
        <span>View</span>
      </button>
    </nav>
  );
}

export interface TableDrawerProps {
  panes: readonly SidePane[];
  pane: SidePane;
  open: boolean;
  unread: number;
  /** False until the stored open state has been applied: the first paint then skips the slide. */
  settled: boolean;
  card: ReactNode;
  log: ReactNode;
  masters: ReactNode;
  settings: ReactNode;
  onSelect: (pane: SidePane) => void;
  onClose: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  ref?: Ref<HTMLElement>;
}

/**
 * The wide table's drawer. It is always mounted (the Log keeps the rows it built), slides in by transform and opacity,
 * and while closed it is inert and hidden from assistive tech. The table reflows around it: it is a grid column, so
 * nothing sits under it.
 */
export function TableDrawer({ panes, pane, open, unread, settled, card, log, masters, settings, onSelect, onClose, onKeyDown, ref }: TableDrawerProps) {
  const roomStyles = useSkinStyles(baseRoomStyles, "side");
  return (
    <aside
      ref={ref}
      id={DRAWER_ID}
      className={styles.drawer}
      data-testid="table-drawer"
      data-table-chrome=""
      data-open={open ? "true" : "false"}
      data-settled={settled ? "true" : "false"}
      aria-label="Panel drawer"
      aria-hidden={open ? undefined : true}
      inert={!open}
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        <SideTabs panes={panes} selected={pane} unread={unread} onSelect={onSelect} labels={{ masters: "Master" }} controlsMasters />
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close panel" title="Close (Esc)">
          <X size={16} strokeWidth={1.75} aria-hidden />
          <kbd>Esc</kbd>
        </button>
      </div>
      <div className={roomStyles.sideContent} {...cardScrollerProps(pane === "card")}>
        <SidePanel pane="card" selected={pane}>{card}</SidePanel>
        <SidePanel pane="log" selected={pane} keepMounted>{log}</SidePanel>
        {panes.includes("masters") ? <SidePanel pane="masters" selected={pane}><div className={styles.masters}>{masters}</div></SidePanel> : null}
        <SidePanel pane="settings" selected={pane}>{settings}</SidePanel>
      </div>
    </aside>
  );
}
