"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Crown, Info, ScrollText, SlidersHorizontal, X } from "lucide-react";
import { zoneKey, LOCATION_DMZONE } from "./constants";
import { EdgeDrawer } from "./edge-drawer";
import { anyLegal } from "./field-keys";
import { masterCard, withExact } from "./field";
import { cardExtraLines, cardScrollerProps } from "./inspector";
import { ChainTower, HUD_PANE_LABEL, type HudPane } from "./table/grid-hud";
import { GridMasterToken } from "./table/grid-master";
import { GridHoverPreview } from "./table/grid-preview";
import { HUD_KEEP, type HudLayerProps, type HudMasterProps } from "./table/hud-layer";
import hudStyles from "./table/grid-hud.module.css";
import styles from "./room-edge-layer.module.css";

/**
 * The side content of the 1v1 room as edge drawers. The Deck Master (yours and the rival's), the Card inspect, the duel
 * log and the settings each have a small tab on the screen edge and slide out only when asked for, so nothing sits on
 * the field in normal play. One drawer is open at a time (`hud.pane`). The tab glows when there is something new:
 * unread log rows, or a legal Deck Master action. The chain tower and the hover peek stay where they were: they hold
 * live state and avoid the field themselves.
 */
export type RoomEdgeLayerProps = HudLayerProps;

/** The Deck Master has something to do now: a legal action for it, or a prompt that asks for the card. */
export function masterHasMove(master: HudMasterProps | null | undefined): boolean {
  const view = master?.view;
  if (!master || !view?.deckMaster || !master.local) return false;
  const card = masterCard(view);
  if (!card) return false;
  const keys = withExact(card, [zoneKey(view.seat, LOCATION_DMZONE, 0)]);
  return anyLegal(keys, master.legalKeys) || (master.canAct && master.legalActionsFor(card, keys).length > 0);
}

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
  hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, master, otherMaster = null, onInspect, preview, equipLinks,
  previewHidden, reducedMotion, hoverAnchor = null, ownSeats,
}: RoomEdgeLayerProps) {
  const { pane, setPane, close } = hud;
  const bind = useCallback((id: HudPane) => ({
    open: pane === id,
    onOpenChange: (open: boolean) => { if (open) setPane(id); else if (pane === id) close(); },
  }), [pane, setPane, close]);

  // The details inside a Deck Master plate (the plate's own token) belong to the drawer: they go when it closes.
  const [details, setDetails] = useState<"master" | "other" | null>(null);
  useEffect(() => { if (pane !== "master" && pane !== "other") setDetails(null); }, [pane]);
  const inspect = useCallback((target: Parameters<typeof onInspect>[0]) => { onInspect(target); setPane("card"); }, [onInspect, setPane]);

  // A hovered board card says only what the art already shows (negated); a pinned one adds its equip, counter and material lines.
  const pinnedBoard = preview?.pinned === true && "location" in preview.card ? preview.card : null;
  const hoveredBoard = preview != null && !preview.pinned && "location" in preview.card ? preview.card : null;
  const extras = useMemo(
    () => (pinnedBoard ? cardExtraLines(pinnedBoard, equipLinks) : []),
    [pinnedBoard, hoveredBoard, equipLinks],
  );
  const { pinAnchor } = hud;
  const closePin = useCallback((byKeyboard: boolean) => {
    close();
    if (!byKeyboard) return;
    const target = pinAnchor?.isConnected ? (pinAnchor.matches("button, [tabindex]") ? pinAnchor : pinAnchor.querySelector<HTMLElement>("button, [tabindex]")) : null;
    target?.focus({ preventScroll: true });
  }, [close, pinAnchor]);

  const plate = (props: HudMasterProps, id: "master" | "other") => (
    <div className={styles.masterHost} data-slot={id === "other" ? "other" : "own"}>
      <GridMasterToken
        {...props}
        slot={id === "other" ? "other" : "own"}
        open={details === id}
        onToggle={() => setDetails((now) => (now === id ? null : id))}
        onClose={() => setDetails(null)}
        onInspect={inspect}
      />
    </div>
  );

  return (
    <>
      {chainOpen ? <ChainTower chain={chain} nameOf={nameOf} tones={seatTones} /> : null}

      {master ? (
        <EdgeDrawer side="left" label="Deck Master" tone="gold" icon={<Crown size={14} strokeWidth={1.75} />} shortcut="m" hoverOpen={false}
          attention={pane !== "master" && masterHasMove(master)} tabOffset="24%" size="min(224px, 88vw)" {...bind("master")}>
          {plate(master, "master")}
        </EdgeDrawer>
      ) : null}
      <EdgeDrawer side="left" label="Card" icon={<Info size={14} strokeWidth={1.75} />} shortcut="i" hoverOpen={false}
        tabOffset={master ? "52%" : "34%"} size="min(380px, 88vw)" {...bind("card")}>
        <Pane kind="card" open={pane === "card"} label={HUD_PANE_LABEL.card} closeLabel="Close Card panel" onClose={close}>{panels.card}</Pane>
      </EdgeDrawer>

      {otherMaster ? (
        <EdgeDrawer side="right" label="Rival Master" icon={<Crown size={14} strokeWidth={1.75} />} hoverOpen={false}
          tabOffset="20%" size="min(224px, 88vw)" {...bind("other")}>
          {plate(otherMaster, "other")}
        </EdgeDrawer>
      ) : null}
      <EdgeDrawer side="right" label="Log" icon={<ScrollText size={14} strokeWidth={1.75} />} shortcut="l" hoverOpen={false}
        attention={pane !== "log" && logUnread > 0} count={pane === "log" ? 0 : logUnread} tabOffset="42%" size="min(420px, 88vw)" {...bind("log")}>
        <Pane kind="log" open={pane === "log"} label={HUD_PANE_LABEL.log} closeLabel="Close Log panel" onClose={close}>{panels.log}</Pane>
      </EdgeDrawer>
      <EdgeDrawer side="right" label="Settings" icon={<SlidersHorizontal size={14} strokeWidth={1.75} />} hoverOpen={false}
        tabOffset="62%" size="min(340px, 88vw)" {...bind("settings")}>
        <Pane kind="settings" open={pane === "settings"} label={HUD_PANE_LABEL.settings} closeLabel="Close Settings panel" onClose={close}>{panels.settings}</Pane>
      </EdgeDrawer>

      <GridHoverPreview
        card={hud.pane == null && !previewHidden && preview ? preview.card : null}
        owner={preview?.owner ?? null}
        reducedMotion={reducedMotion}
        pinned={preview?.pinned === true}
        extras={extras}
        avoid={preview?.pinned === true ? hud.pinAnchor : null}
        hoverAnchor={preview?.pinned === true ? null : hoverAnchor}
        ownSeats={ownSeats}
        onClose={closePin}
      />
    </>
  );
}
