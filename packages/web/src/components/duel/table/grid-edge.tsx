"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Link2, ScrollText, Search, SlidersHorizontal } from "lucide-react";
import type { DuelChainLink } from "@yugidraft/shared/duels";
import { EdgeDrawer } from "@/components/duel/edge-drawer";
import { cardScrollerProps, type InspectTarget } from "../inspector";
import { ChainTower, type HudPane } from "./grid-hud";
import type { HudPaneState } from "./hud-layer";
import styles from "./grid-hud.module.css";

/**
 * The side content of the 4-way grid as left-edge drawers (bigger-field contract). The log, the settings, the Deck Master, the live
 * chain and the card panel are closed by default: only a small glowing tab shows at the left edge, so the board runs the whole width.
 * One drawer is open at most; the open one is the shell's `hud.pane`, so every opener of the flyout (a dock icon of the old HUD, Inspect
 * on a plate, a log row) works unchanged. A drawer opens from its tab (click, Enter, Space or a resting mouse), from its key, or from the
 * shell; Escape and a press outside close it. The tab glows when something needs a look: new log rows, a Deck Master action you can
 * take, a live chain.
 */

/** The tab: 26px wide, a label rotated on its side. Used to stack the tabs without overlap (they are placed by their centre). */
const TAB_PAD = 12;
const TAB_ICON = 14;
const TAB_GAP = 6;
const TAB_CHAR = 7.6;
const TAB_BADGE = 21;
const TAB_SPACE = 10;
/** Where the first tab starts, from the top of the drawer area. */
const TAB_START = 36;

function tabHeight(label: string, count: number): number {
  return TAB_PAD + TAB_ICON + TAB_GAP + Math.round(label.length * TAB_CHAR) + (count > 0 ? TAB_BADGE : 0);
}

interface Entry {
  id: HudPane;
  label: string;
  icon: ReactNode;
  count?: number;
  attention?: boolean;
  tone?: "violet" | "gold";
  shortcut?: string;
  size?: string;
  node: ReactNode;
}

export interface EdgeHudProps {
  hud: HudPaneState;
  panels: { card: ReactNode; settings: ReactNode; log?: ReactNode };
  chain: readonly DuelChainLink[];
  /** A chain is live: the Chain tab shows. */
  chainOpen: boolean;
  nameOf: (seat: number) => string;
  seatTones: ReadonlyMap<number, { main: string; ink: string }>;
  logUnread: number;
  onInspect: (target: InspectTarget) => void;
}

export function EdgeHud({ hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, onInspect }: EdgeHudProps) {
  const { pane, setPane } = hud;
  const entries: Entry[] = [];
  entries.push({
    id: "log", label: "Log", icon: <ScrollText />, count: logUnread, attention: logUnread > 0, shortcut: "l", size: "min(460px, 92vw)",
    node: panels.log,
  });
  entries.push({ id: "settings", label: "Settings", icon: <SlidersHorizontal />, size: "min(420px, 92vw)", node: panels.settings });
  if (chainOpen && chain.length > 0) {
    entries.push({
      id: "chain", label: "Chain", icon: <Link2 />, count: chain.length, attention: true, tone: "gold", size: "min(300px, 92vw)",
      node: <ChainTower chain={chain} nameOf={nameOf} tones={seatTones} />,
    });
  }
  entries.push({ id: "card", label: "Inspect", icon: <Search />, shortcut: "i", size: "min(400px, 92vw)", node: panels.card });

  // The chain drawer goes with the chain: a pane that has no tab any more must not hold the shell's Esc and hide the peek.
  useEffect(() => { if (pane === "chain" && !(chainOpen && chain.length > 0)) setPane(null); }, [pane, chainOpen, chain.length, setPane]);

  let y = TAB_START;
  return (
    <>
      {entries.map((entry) => {
        const height = tabHeight(entry.label, entry.count ?? 0);
        const offset = y + height / 2;
        y += height + TAB_SPACE;
        const open = pane === entry.id;
        return (
          <EdgeDrawer
            key={entry.label}
            side="left"
            label={entry.label}
            icon={entry.icon}
            count={entry.count}
            attention={entry.attention}
            tone={entry.tone}
            shortcut={entry.shortcut}
            size={entry.size}
            tabOffset={`${Math.round(offset)}px`}
            open={open}
            onOpenChange={(next) => {
              if (next) setPane(entry.id);
              else if (pane === entry.id) setPane(null);
            }}
            className={styles.edgeDrawer}
            panelClassName={styles.edgePanel}
          >
            <div className={styles.edgeBody} data-pane={entry.id} data-hud-keep="" {...(entry.id === "card" ? cardScrollerProps(open) : {})}>
              {entry.node}
            </div>
          </EdgeDrawer>
        );
      })}
    </>
  );
}
