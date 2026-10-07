"use client";

import { useCallback, useEffect, useMemo, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import type { DuelCard, DuelCardInfo, DuelChainLink, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import type { DuelHoverHandler } from "../field-keys";
import { ChainTower, DOCK_PANES, DOCK_PANES_CAMERA, GridDock, GridFlyout, useHudDismiss, type DockPane, type HudPane } from "./grid-hud";
import { GridMasterToken } from "./grid-master";
import { GridHoverPreview } from "./grid-preview";
import type { DuelActivateHandler, InspectTarget } from "./types";

/**
 * The floating HUD that the 4-way grid, the 1v1 room and the Tag Rooftop share (concept B): which flyout is open, and
 * the layer of dock, chain tower, Deck Master token, flyout and hover preview. The shells keep their own bars, boards
 * and panes; they only feed this layer their real panels and duel data.
 */

/** The Log pane stays mounted while hidden, so its rows and its unread count survive a close. So does the Camera pane of the Tag Rooftop: its lock state and seat buttons stay live. */
export const HUD_KEEP: readonly HudPane[] = ["log", "camera"];

export interface HudPaneState {
  pane: HudPane | null;
  setPane: (pane: HudPane | null) => void;
  toggle: (pane: HudPane) => void;
  close: () => void;
  /** Opens the Card flyout: a click or Inspect on a card. */
  openCard: () => void;
  /** The Card tab only shows while it is the open pane: it is not a dock icon. */
  tabs: readonly HudPane[];
  /** The dock icons, in order. */
  dock: readonly DockPane[];
}

/**
 * The open flyout of a HUD. Nothing opens it by itself: a dock icon, a Deck Master token or `openCard()` (a click or
 * Inspect on a card) does. A hover or a prompt row never opens the Card flyout, so it cannot cover the response prompt.
 * Call it before `useTableUi`, then pass `openCard` on and give `useHudEscape` the table's `suspended` flag.
 */
export function useHudPane({ camera = false, log = true }: {
  /** The table has a camera panel (the Tag Rooftop, the 3-way plaza): the dock gets a camera icon. */
  camera?: boolean;
  /** The dock has the Log icon. The 3-way plaza has none: it keeps Settings and Camera only. */
  log?: boolean;
} = {}): HudPaneState {
  const [pane, setPane] = useState<HudPane | null>(null);
  const toggle = useCallback((next: HudPane) => setPane((current) => (current === next ? null : next)), []);
  const close = useCallback(() => setPane(null), []);
  const openCard = useCallback(() => setPane("card"), []);
  const dock = useMemo<readonly DockPane[]>(() => (camera ? DOCK_PANES_CAMERA : DOCK_PANES).filter((id) => log || id !== "log"), [camera, log]);
  const tabs: readonly HudPane[] = pane === "card" ? ["card", ...dock] : dock;
  return { pane, setPane, toggle, close, openCard, tabs, dock };
}

/**
 * Esc and a press outside close the open flyout. A card menu or the pile viewer (`suspended`) keeps Esc, and so does a
 * modal dialog. Pass `hud.pane != null` to the prompt panel's `escapeHeld` as well, or the same Esc also declines the
 * prompt. The other prompt keys keep answering while a flyout is open.
 */
export function useHudEscape(hud: HudPaneState, enabled: boolean, suspended: boolean): void {
  useHudDismiss(enabled && hud.pane != null, suspended, hud.close);
}

/**
 * The card of a prompt row under the pointer or focus (a tile, a response row): the HUD shows it in the hover preview,
 * never in the Card flyout, which would cover the prompt. The prompt panel only reports "entered", so `bind` goes on a
 * wrapper around it (`display: contents`) and clears the card when the pointer or focus leaves the panel.
 * `resetKey` (the prompt id) clears it when the prompt changes.
 */
export function useRowPreview(resetKey: string | number | null) {
  const [card, setCard] = useState<DuelCardInfo | null>(null);
  useEffect(() => setCard(null), [resetKey]);
  const leave = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCard(null);
  };
  return { card, show: setCard, bind: { onMouseOut: leave, onBlur: leave } };
}

/** Wraps the prompt panel for `useRowPreview`. Without the HUD it renders the children as they are. */
export function RowPreviewBoundary({ row, enabled, children }: { row: ReturnType<typeof useRowPreview>; enabled: boolean; children: ReactNode }) {
  return enabled ? <div style={{ display: "contents" }} {...row.bind}>{children}</div> : <>{children}</>;
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
  /** A click on the token picks the card while a prompt asks for it. */
  onActivate?: DuelActivateHandler;
  onHoverCard?: DuelHoverHandler;
}

export interface HudLayerProps {
  hud: HudPaneState;
  /** The Card panel, Log panel and Settings panel. The dock icons come from `hud.dock`. */
  panels: Pick<Record<HudPane, ReactNode>, "card" | "settings"> & { log?: ReactNode; camera?: ReactNode };
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
  /** The hovered card and its owner, or `null` when nothing is hovered. A prompt row card has no owner. */
  preview: { card: DuelCard | DuelCardInfo; owner: { name: string; main: string; ink: string } | null } | null;
  /** A card menu or the pile viewer is open: the preview hides. An open flyout hides it too. */
  previewHidden: boolean;
  reducedMotion: boolean;
}

export function HudLayer({ hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, master, otherMaster = null, onInspect, preview, previewHidden, reducedMotion }: HudLayerProps) {
  return (
    <>
      <GridDock pane={hud.pane} onToggle={hud.toggle} unread={logUnread} panes={hud.dock} />
      {chainOpen ? <ChainTower chain={chain} nameOf={nameOf} tones={seatTones} /> : null}
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
      <GridFlyout pane={hud.pane} tabs={hud.tabs} panels={panels} keepMounted={HUD_KEEP} onSelect={hud.setPane} onClose={hud.close} chainLive={chainOpen} />
      <GridHoverPreview card={hud.pane == null && !previewHidden && preview ? preview.card : null} owner={preview?.owner ?? null} reducedMotion={reducedMotion} />
    </>
  );
}
