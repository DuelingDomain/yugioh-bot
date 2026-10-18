"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Link2, ScrollText, SlidersHorizontal } from "lucide-react";
import type { DuelChainLink } from "@yugidraft/shared/duels";
import { EdgeDrawer } from "@/components/duel/edge-drawer";
import { ChainTower, type HudPane } from "./grid-hud";
import type { HudPaneState } from "./hud-layer";
import styles from "./grid-hud.module.css";

/**
 * The side content of the 4-way grid as left-edge drawers (bigger-field contract). The log, the settings and the live chain are closed
 * by default: only a small glowing tab shows at the left edge, so the board runs the whole width.
 * One drawer is open at most; the open one is the shell's `hud.pane`. A drawer opens from its tab (click, Enter or Space), from its key, or from the
 * shell, never from a resting mouse; Escape and a press outside close it. The tabs of the closed drawers stand on the outer face of the open
 * one (edge-drawer.tsx), so each stays in view and the user can switch at any time. The tab glows when something needs a look: new log rows,
 * a live chain.
 *
 * There is no Inspect drawer: a click on a card, and Inspect on a Deck Master or a log row, open the pinned card pop-out (grid-preview.tsx).
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
  panels: { settings: ReactNode; log?: ReactNode };
  chain: readonly DuelChainLink[];
  /** A chain is live: the Chain tab shows. */
  chainOpen: boolean;
  nameOf: (seat: number) => string;
  seatTones: ReadonlyMap<number, { main: string; ink: string }>;
  logUnread: number;
}

export function EdgeHud({ hud, panels, chain, chainOpen, nameOf, seatTones, logUnread }: EdgeHudProps) {
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
            <div className={styles.edgeBody} data-pane={entry.id} data-hud-keep="">
              {entry.node}
            </div>
          </EdgeDrawer>
        );
      })}
    </>
  );
}
