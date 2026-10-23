"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link2, ScrollText, SlidersHorizontal, Video, X } from "lucide-react";
import { EdgeDrawer } from "../edge-drawer";
import { pinnedExtraLines, NEGATED_LINE } from "../inspector";
import { useLeftTabHeights } from "../tag/tag-drawers";
import { ChainTower, HUD_PANE_LABEL, type HudPane } from "./grid-hud";
import { GridHoverPreview } from "./grid-preview";
import type { HudLayerProps } from "./hud-layer";
import styles from "./plaza-drawers.module.css";

/**
 * The side content of the 3-way plaza. Nothing stands on the field at rest: the dock, the chain tower, the Deck Master
 * plate and the flyout of the floating HUD are drawers that start closed, and each shows only a small edge tab. A tab
 * glows when something is new (the log) or when you can act (the Deck Master, a live chain). The open pane is the shell's
 * own `hud.pane`, so one drawer is open at a time and Esc and the press outside work as before; the drawers only draw it.
 * A drawer opens only from a click or key on its tab. The tabs of the closed drawers stand on the outer face of the open one,
 * so every tab stays in view (edge-drawer.tsx).
 *
 * There is no Inspect drawer: a click on a card, and Inspect on a Deck Master or a log row, open the pinned card pop-out (grid-preview.tsx).
 *
 * Every tab is on the left edge, like Tag and the 4-way grid: Log, Settings, Camera and, while a chain is live, Chain. They stack close
 * together from the top down (PLAZA_TAB_START, PLAZA_TAB_GAP), so the bottom-left corner stays free for the Deck Master card.
 */

/** Where the first tab starts below the top of the drawer area, and the gap between two tabs. The tab column stays in the top half. */
const PLAZA_TAB_START = 12;
const PLAZA_TAB_GAP = 6;
/** Tab heights before the first measure, so the first paint is close. */
const PLAZA_TAB_GUESS = [60, 97, 87, 90];

/** A closed drawer keeps its content for the slide out, then lets it go (the settings only mount while shown). */
const SLIDE_MS = 260;

function useLinger(open: boolean): boolean {
  const [held, setHeld] = useState(open);
  useEffect(() => {
    if (open) { setHeld(true); return; }
    const timer = window.setTimeout(() => setHeld(false), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return open || held;
}

/** The pane of a drawer: a title row with a close button over the scrolling content. */
function Pane({ title, onClose, scrolls = true, children }: { title: string; onClose: () => void; scrolls?: boolean; children: ReactNode }) {
  return (
    <div className={styles.pane} data-hud-keep="" data-pane-title={title}>
      <header className={styles.paneHead}>
        <b>{title}</b>
        <button type="button" className={styles.paneClose} aria-label={`Close ${title}`} onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className={styles.paneBody} data-scrolls={scrolls ? "true" : "false"}>{children}</div>
    </div>
  );
}

/** The plaza's drawers, in place of the floating HUD layer. Same props as `HudLayer`. */
export function PlazaDrawers({ hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, preview, equipLinks, previewHidden, reducedMotion }: HudLayerProps) {
  const { pane, setPane, close, pinned, pinAnchor } = hud;
  const bind = (id: HudPane) => ({
    open: pane === id,
    onOpenChange: (next: boolean) => {
      if (next) setPane(id);
      else if (pane === id) close();
    },
  });

  // The chain drawer goes with the chain: a pane that has no tab any more must not hold the shell's Esc and hide the peek.
  useEffect(() => { if (pane === "chain" && !chainOpen) setPane(null); }, [pane, chainOpen, setPane]);

  const settingsMounted = useLinger(pane === "settings");

  const pinnedBoard = preview?.pinned === true && "location" in preview.card ? preview.card : null;
  const hoveredBoard = preview != null && !preview.pinned && "location" in preview.card ? preview.card : null;
  const extras = useMemo(
    () => (pinnedBoard ? pinnedExtraLines(pinnedBoard, equipLinks) : hoveredBoard?.negated === true ? [NEGATED_LINE] : []),
    [pinnedBoard, hoveredBoard, equipLinks],
  );
  const closePin = useCallback((byKeyboard: boolean) => {
    close();
    if (!byKeyboard) return;
    const target = pinAnchor?.isConnected ? (pinAnchor.matches("button, [tabindex]") ? pinAnchor : pinAnchor.querySelector<HTMLElement>("button, [tabindex]")) : null;
    target?.focus({ preventScroll: true });
  }, [close, pinAnchor]);

  // `data-hud-keep` on a `display: contents` wrapper: a press on a tab is not "outside" for the shell's dismiss listener,
  // which would close the pane on pointer down and let the click open it again.
  const keep = (node: ReactNode, key?: string) => <div key={key} className={styles.keep} data-hud-keep="">{node}</div>;

  // Tab centres, stacked from the top of the drawer area with a small gap. Heights are read from the tabs, which grow with the text size.
  const tabs: Array<{ id: HudPane; label: string; icon: ReactNode; count?: number; attention?: boolean; tone?: "violet" | "gold"; shortcut?: string; size: string; node: ReactNode }> = [
    { id: "log", label: "Log", icon: <ScrollText />, count: logUnread, attention: logUnread > 0, shortcut: "l", size: "min(460px, 88vw)",
      // The log stays mounted while it is closed: it keeps its rows and counts the new ones.
      node: <Pane title={HUD_PANE_LABEL.log} onClose={close} scrolls={false}>{panels.log}</Pane> },
    { id: "settings", label: "Settings", icon: <SlidersHorizontal />, size: "min(360px, 88vw)",
      node: settingsMounted ? <Pane title={HUD_PANE_LABEL.settings} onClose={close}>{panels.settings}</Pane> : null },
  ];
  // The camera panel stays mounted: its lock state and seat buttons stay live.
  if (panels.camera) tabs.push({ id: "camera", label: "Camera", icon: <Video />, shortcut: "c", size: "min(340px, 88vw)", node: <Pane title={HUD_PANE_LABEL.camera} onClose={close}>{panels.camera}</Pane> });
  if (chainOpen) {
    tabs.push({ id: "chain", label: "Chain", icon: <Link2 />, count: chain.length, attention: true, tone: "gold", size: "min(300px, 88vw)",
      node: <Pane title={HUD_PANE_LABEL.chain} onClose={close}><div className={styles.chainSlot}><ChainTower chain={chain} nameOf={nameOf} tones={seatTones} /></div></Pane> });
  }

  const rootRef = useRef<HTMLDivElement>(null);
  const heights = useLeftTabHeights(rootRef, [tabs.length, logUnread, chain.length]);
  let y = PLAZA_TAB_START;
  return (
    <div ref={rootRef} className={styles.keep}>
      {tabs.map((tab, index) => {
        const height = heights[index] ?? PLAZA_TAB_GUESS[index] ?? 80;
        const offset = y + height / 2;
        y += height + PLAZA_TAB_GAP;
        return keep(
          <EdgeDrawer
            key={tab.id}
            side="left" label={tab.label} icon={tab.icon} tone={tab.tone} attention={tab.attention} count={tab.count} shortcut={tab.shortcut}
            tabOffset={`${Math.round(offset)}px`} size={tab.size} className={styles.drawer} panelClassName={styles.panel}
            {...bind(tab.id)}
          >
            {tab.node}
          </EdgeDrawer>,
          tab.id,
        );
      })}
      <GridHoverPreview
        card={pane == null && !previewHidden && preview ? preview.card : null}
        owner={preview?.owner ?? null}
        reducedMotion={reducedMotion}
        pinned={preview?.pinned === true}
        held={preview?.held === true}
        extras={extras}
        onClose={closePin}
      />
    </div>
  );
}
