"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { Info, ScrollText, SlidersHorizontal, X } from "lucide-react";
import { EdgeDrawer } from "./edge-drawer";
import { pinnedExtraLines, cardScrollerProps } from "./inspector";
import { ChainTower, HUD_PANE_LABEL, type HudPane } from "./table/grid-hud";
import { GridHoverPreview } from "./table/grid-preview";
import { HUD_KEEP, type HudLayerProps } from "./table/hud-layer";
import hudStyles from "./table/grid-hud.module.css";
import styles from "./room-edge-layer.module.css";

/**
 * The side content of the 1v1 room as edge drawers. The Card inspect, the duel log and the settings each have a small
 * tab on the screen edge and slide out only when asked for, so nothing sits on the field in normal play. One drawer is
 * open at a time (`hud.pane`). The tab glows when there is something new: unread log rows. The chain tower and the
 * hover peek stay where they were: they hold live state and avoid the field themselves. The Deck Masters are not here:
 * each one is a portrait badge in its player's name plate (master-badge.tsx).
 */
export type RoomEdgeLayerProps = Omit<HudLayerProps, "master" | "otherMaster">;

/** Keeps a drawer's panel content: a title row with a close button, then the body. */
function Pane({ label, closeLabel, onClose, children, kind, open }: { label: string; closeLabel: string; onClose: () => void; children: ReactNode; kind: HudPane; open: boolean }) {
  // A pane builds its content only while open; the log stays mounted while shut, so it keeps its rows and its scroll.
  const content = open || HUD_KEEP.includes(kind) ? children : null;
  return (
    <section className={styles.pane} data-pane={kind} data-hud-keep="" data-testid={`hud-pane-${kind}`} aria-label={label}>
      <header className={styles.paneHead}>
        <b>{label}</b>
        <button type="button" className={hudStyles.flyClose} aria-label={closeLabel} data-testid="hud-close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className={styles.paneBody} {...cardScrollerProps(kind === "card")}>{content}</div>
    </section>
  );
}

export function RoomEdgeLayer({
  hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, preview, equipLinks,
  previewHidden, reducedMotion
}: RoomEdgeLayerProps) {
  const { pane, setPane, close } = hud;
  const bind = useCallback((id: HudPane) => ({
    open: pane === id,
    onOpenChange: (open: boolean) => { if (open) setPane(id); else if (pane === id) close(); },
  }), [pane, setPane, close]);

  // A pinned board card adds its equip and material lines to the drawer (protections, counters and negation come from its status list).
  const pinnedBoard = preview?.pinned === true && "location" in preview.card ? preview.card : null;
  const extras = useMemo(
    () => (pinnedBoard ? pinnedExtraLines(pinnedBoard, equipLinks) : []),
    [pinnedBoard, equipLinks],
  );
  const { pinAnchor } = hud;
  const closePin = useCallback((byKeyboard: boolean) => {
    close();
    if (!byKeyboard) return;
    const target = pinAnchor?.isConnected ? (pinAnchor.matches("button, [tabindex]") ? pinAnchor : pinAnchor.querySelector<HTMLElement>("button, [tabindex]")) : null;
    target?.focus({ preventScroll: true });
  }, [close, pinAnchor]);

  return (
    <>
      {chainOpen ? <ChainTower chain={chain} nameOf={nameOf} tones={seatTones} /> : null}

      <EdgeDrawer side="left" label="Card" icon={<Info size={14} strokeWidth={1.75} />} shortcut="i"
        tabOffset="34%" size="min(400px, 88vw)" {...bind("card")}>
        <Pane kind="card" open={pane === "card"} label={HUD_PANE_LABEL.card} closeLabel="Close Card panel" onClose={close}>{panels.card}</Pane>
      </EdgeDrawer>

      <EdgeDrawer side="right" label="Log" icon={<ScrollText size={14} strokeWidth={1.75} />} shortcut="l"
        attention={pane !== "log" && logUnread > 0} count={pane === "log" ? 0 : logUnread} tabOffset="42%" size="min(420px, 88vw)" {...bind("log")}>
        <Pane kind="log" open={pane === "log"} label={HUD_PANE_LABEL.log} closeLabel="Close Log panel" onClose={close}>{panels.log}</Pane>
      </EdgeDrawer>
      <EdgeDrawer side="right" label="Settings" icon={<SlidersHorizontal size={14} strokeWidth={1.75} />}
        tabOffset="62%" size="min(340px, 88vw)" {...bind("settings")}>
        <Pane kind="settings" open={pane === "settings"} label={HUD_PANE_LABEL.settings} closeLabel="Close Settings panel" onClose={close}>{panels.settings}</Pane>
      </EdgeDrawer>

      <GridHoverPreview
        card={hud.pane == null && !previewHidden && preview ? preview.card : null}
        owner={preview?.owner ?? null}
        reducedMotion={reducedMotion}
        pinned={preview?.pinned === true}
        held={preview?.held === true}
        pin={preview?.pin ?? null}
        extras={extras}
        onClose={closePin}
      />
    </>
  );
}
