"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DuelCard, DuelChainLink, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import type { DuelHoverHandler } from "../field-keys";
import { ChainList, ChainTower, DOCK_PANES, GridDock, GridFlyout, useHudDismiss, type HudPane } from "./grid-hud";
import { GridMasterToken } from "./grid-master";
import { GridHoverPreview } from "./grid-preview";
import type { InspectTarget } from "./types";

/**
 * The floating HUD that the 4-way grid, the 1v1 room and the Tag Rooftop share (concept B): which flyout is open, and
 * the layer of dock, chain tower, Deck Master token, flyout and hover preview. The shells keep their own bars, boards
 * and panes; they only feed this layer their real panels and duel data.
 */

/** The Log pane stays mounted while hidden, so its rows and its unread count survive a close. */
export const HUD_KEEP: readonly HudPane[] = ["log"];

export interface HudPaneState {
  pane: HudPane | null;
  setPane: (pane: HudPane | null) => void;
  toggle: (pane: HudPane) => void;
  close: () => void;
  /** The Card tab only shows while it is the open pane: it is not a dock icon. */
  tabs: readonly HudPane[];
}

/**
 * The open flyout of a HUD. Esc and a press outside close it (`useHudDismiss`). A new inspect target (a click or
 * Inspect on a card) opens the Card pane, unless that click opened an action menu: the menu keeps the board clear.
 */
export function useHudPane({ enabled, suspended, inspect, menuOpen }: {
  enabled: boolean;
  /** A card menu or the pile viewer is open: it keeps Esc. */
  suspended: boolean;
  inspect: InspectTarget | null;
  menuOpen: boolean;
}): HudPaneState {
  const [pane, setPane] = useState<HudPane | null>(null);
  const toggle = useCallback((next: HudPane) => setPane((current) => (current === next ? null : next)), []);
  const close = useCallback(() => setPane(null), []);
  useHudDismiss(enabled && pane != null, suspended, close);
  useEffect(() => {
    if (enabled && inspect && !menuOpen) setPane("card");
    // Only a new inspect target opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, inspect]);
  const tabs: readonly HudPane[] = pane === "card" ? ["card", ...DOCK_PANES] : DOCK_PANES;
  return { pane, setPane, toggle, close, tabs };
}

type SeatTones = ReadonlyMap<number, { main: string; ink: string }>;

export interface HudMasterProps {
  view: DuelSeatView | undefined;
  /** The plate is yours: it offers actions. A spectator's plate only shows the card. */
  local: boolean;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  canAct: boolean;
  legalActionsFor: (card: DuelCard | null, keys: string[]) => DuelPromptOption[];
  title: string;
  onChooseAction: (option: DuelPromptOption) => void;
  onHoverCard?: DuelHoverHandler;
}

export interface HudLayerProps {
  hud: HudPaneState;
  /** The Card panel, Log panel and Settings panel; the Chain panel is built here from `chain`. */
  panels: Pick<Record<HudPane, ReactNode>, "card" | "log" | "settings">;
  chain: readonly DuelChainLink[];
  /** A chain is live: the tower shows under the dock. */
  chainOpen: boolean;
  nameOf: (seat: number) => string;
  seatTones: SeatTones;
  logUnread: number;
  /** The Deck Master token (Domain only). `null` hides it. */
  master: HudMasterProps | null;
  /** The second plate: the rival's master in a 1v1 duel, the partner's in a Tag duel. `null` hides it. */
  otherMaster?: HudMasterProps | null;
  /** Shows the Card flyout for the master (Inspect on the plate). */
  onInspect: (target: InspectTarget) => void;
  /** The hovered card and its owner, or `null` when nothing is hovered. */
  preview: { card: DuelCard; owner: { name: string; main: string; ink: string } } | null;
  /** A card menu or the pile viewer is open: the preview hides. An open flyout hides it too. */
  previewHidden: boolean;
  reducedMotion: boolean;
}

export function HudLayer({ hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, master, otherMaster = null, onInspect, preview, previewHidden, reducedMotion }: HudLayerProps) {
  const chainCount = chainOpen ? chain.length : 0;
  const allPanels: Partial<Record<HudPane, ReactNode>> = {
    ...panels,
    chain: <ChainList chain={chain} nameOf={nameOf} tones={seatTones} />,
  };
  return (
    <>
      <GridDock pane={hud.pane} onToggle={hud.toggle} unread={logUnread} chainCount={chainCount} />
      {chainOpen ? <ChainTower chain={chain} nameOf={nameOf} tones={seatTones} onOpen={() => hud.setPane("chain")} /> : null}
      {master ? (
        <GridMasterToken
          {...master}
          open={hud.pane === "master"}
          onToggle={() => hud.toggle("master")}
          onClose={hud.close}
          onInspect={(target) => { onInspect(target); hud.setPane("card"); }}
        />
      ) : null}
      {otherMaster ? (
        <GridMasterToken
          {...otherMaster}
          slot="other"
          open={hud.pane === "other"}
          onToggle={() => hud.toggle("other")}
          onClose={hud.close}
          onInspect={(target) => { onInspect(target); hud.setPane("card"); }}
        />
      ) : null}
      <GridFlyout pane={hud.pane} tabs={hud.tabs} panels={allPanels} keepMounted={HUD_KEEP} onSelect={hud.setPane} onClose={hud.close}
        chainCount={chainCount} chainLive={chainOpen} />
      <GridHoverPreview card={hud.pane == null && !previewHidden && preview ? preview.card : null} owner={preview?.owner ?? null} reducedMotion={reducedMotion} />
    </>
  );
}
