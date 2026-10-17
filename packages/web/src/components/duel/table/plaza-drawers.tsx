"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link2, ScrollText, SlidersHorizontal, Video, X } from "lucide-react";
import { EdgeDrawer } from "../edge-drawer";
import { cardExtraLines, NEGATED_LINE } from "../inspector";
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
 * Left edge: Chain (while one is live). Right edge: Log, Settings, Camera.
 */

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
export function PlazaDrawers({ hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, preview, equipLinks, previewHidden, reducedMotion, hoverAnchor = null, ownSeats }: HudLayerProps) {
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
    () => (pinnedBoard ? cardExtraLines(pinnedBoard, equipLinks) : hoveredBoard?.negated === true ? [NEGATED_LINE] : []),
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
  const keep = (node: ReactNode) => <div className={styles.keep} data-hud-keep="">{node}</div>;

  return (
    <>
      {chainOpen ? keep(
        <EdgeDrawer
          side="left" label="Chain" icon={<Link2 />} tone="gold" attention count={chain.length} tabOffset="28%" size="min(300px, 88vw)" panelClassName={styles.panel}
          {...bind("chain")}
        >
          <Pane title={HUD_PANE_LABEL.chain} onClose={close}>
            <div className={styles.chainSlot}><ChainTower chain={chain} nameOf={nameOf} tones={seatTones} /></div>
          </Pane>
        </EdgeDrawer>,
      ) : null}
      {keep(
        <EdgeDrawer side="right" label="Log" icon={<ScrollText />} attention={logUnread > 0} count={logUnread} shortcut="l" tabOffset="28%" size="min(460px, 88vw)" panelClassName={styles.panel} {...bind("log")}>
          {/* The log stays mounted while it is closed: it keeps its rows and counts the new ones. */}
          <Pane title={HUD_PANE_LABEL.log} onClose={close} scrolls={false}>{panels.log}</Pane>
        </EdgeDrawer>,
      )}
      {keep(
        <EdgeDrawer side="right" label="Settings" icon={<SlidersHorizontal />} tabOffset="44%" size="min(360px, 88vw)" panelClassName={styles.panel} {...bind("settings")}>
          {settingsMounted ? <Pane title={HUD_PANE_LABEL.settings} onClose={close}>{panels.settings}</Pane> : null}
        </EdgeDrawer>,
      )}
      {panels.camera ? keep(
        <EdgeDrawer side="right" label="Camera" icon={<Video />} shortcut="c" tabOffset="58%" size="min(340px, 88vw)" panelClassName={styles.panel} {...bind("camera")}>
          {/* The camera panel stays mounted: its lock state and seat buttons stay live. */}
          <Pane title={HUD_PANE_LABEL.camera} onClose={close}>{panels.camera}</Pane>
        </EdgeDrawer>,
      ) : null}
      <GridHoverPreview
        card={pane == null && !previewHidden && preview ? preview.card : null}
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
