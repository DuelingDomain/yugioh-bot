"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Info, Link2, ScrollText, SlidersHorizontal, Video, X } from "lucide-react";
import type { DuelCard, DuelCardInfo, DuelChainLink } from "@yugidraft/shared/duels";
import { EdgeDrawer } from "../edge-drawer";
import type { EquipLinks } from "../equip-links";
import { cardExtraLines, cardScrollerProps, NEGATED_LINE } from "../inspector";
import { ChainTower, HUD_PANE_LABEL, type HudPane } from "../table/grid-hud";
import { GridHoverPreview } from "../table/grid-preview";
import type { HudPaneState } from "../table/hud-layer";
import type { InspectTarget } from "../table/types";
import styles from "./tag-drawers.module.css";

/**
 * The side content of the wide Rooftop, as edge drawers (see `edge-drawer/`): Log, Card, Settings and Camera on the left,
 * and the chain while one is live. Every drawer is closed until the viewer opens it, so
 * nothing but the field stands beside the board; only the thin edge tabs show, and a tab glows when there is news
 * (unread log rows, a chain). An open drawer may overlay the field.
 *
 * It replaces `HudLayer` on the Rooftop and keeps its contract: `hud` (`useHudPane`) still holds the one open pane, so
 * `useHudEscape`, the pin sync, the prompt's `escapeHeld` and the replay carry-over work as before. The chain tower and
 * the hover peek are the shared ones from `table/`.
 */

type LeftPane = "log" | "card" | "settings" | "camera";

const LEFT_ICON: Record<LeftPane, ReactNode> = {
  log: <ScrollText strokeWidth={1.75} />,
  card: <Info strokeWidth={1.75} />,
  settings: <SlidersHorizontal strokeWidth={1.75} />,
  camera: <Video strokeWidth={1.75} />,
};

/** The left tabs stack from `TAB_TOP` (the header band is 48px high) with `TAB_GAP` between them; chain follows the four panes. */
export const LEFT_TAB_ORDER: readonly LeftPane[] = ["log", "card", "settings", "camera"];
const TAB_TOP = 84;
const TAB_GAP = 10;
/** Tab heights before the first measure (a vertical label is as tall as its text), so the first paint is close. */
const TAB_GUESS = [62, 74, 108, 96, 90];

/** The centre of tab `index` (EdgeDrawer centres its tab on `tabOffset`), given the heights of the tabs above and itself. */
export function leftTabOffset(index: number, heights: readonly number[] = TAB_GUESS): string {
  let top = TAB_TOP;
  for (let i = 0; i < index; i += 1) top += (heights[i] ?? TAB_GUESS[i] ?? 80) + TAB_GAP;
  return `${Math.round(top + (heights[index] ?? TAB_GUESS[index] ?? 80) / 2)}px`;
}

/** Reads the real height of every left tab under `root` (they grow with the text size), so the tabs never overlap. */
function useLeftTabHeights(root: RefObject<HTMLElement | null>, deps: readonly unknown[]): number[] {
  const [heights, setHeights] = useState<number[]>([]);
  const measure = useCallback(() => {
    const tabs = root.current?.querySelectorAll<HTMLElement>('[data-edge-drawer][data-side="left"] button[aria-controls]');
    if (!tabs) return;
    const next = [...tabs].map((tab) => Math.round(tab.offsetHeight));
    setHeights((now) => (now.length === next.length && now.every((value, i) => value === next[i]) ? now : next));
  }, [root]);
  useLayoutEffect(measure, [measure, ...deps]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    const fonts = document.fonts?.ready;
    void fonts?.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  return heights;
}

/** Panel width of each drawer. The log and settings rows need room for names; the card pane is 400px (a large card art). */
const LEFT_SIZE: Record<LeftPane | "chain", string> = {
  log: "min(460px, 92vw)",
  card: "min(400px, 92vw)",
  settings: "min(420px, 92vw)",
  camera: "min(340px, 92vw)",
  chain: "min(240px, 88vw)",
};

/** Keeps `children` mounted a little after the drawer closes, so the panel does not empty while it slides out. */
function useLinger(open: boolean, ms = 300): boolean {
  const [lingering, setLingering] = useState(open);
  useEffect(() => {
    if (open) {
      setLingering(true);
      return;
    }
    const timer = window.setTimeout(() => setLingering(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, ms]);
  return open || lingering;
}

function PaneHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className={styles.head}>
      <b>{title}</b>
      <button type="button" className={styles.close} aria-label="Close panel" data-testid="hud-close" onClick={onClose}>
        <X size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </header>
  );
}

export interface TagDrawersProps {
  hud: HudPaneState;
  panels: Record<LeftPane, ReactNode>;
  chain: readonly DuelChainLink[];
  chainOpen: boolean;
  nameOf: (seat: number) => string;
  seatTones: ReadonlyMap<number, { main: string; ink: string }>;
  logUnread: number;
  onInspect: (target: InspectTarget) => void;
  preview: { card: DuelCard | DuelCardInfo; owner: { name: string; main: string; ink: string } | null; pinned?: boolean } | null;
  equipLinks?: EquipLinks;
  previewHidden: boolean;
  reducedMotion: boolean;
  hoverAnchor?: HTMLElement | null;
  ownSeats?: readonly number[];
}

export function TagDrawers({ hud, panels, chain, chainOpen, nameOf, seatTones, logUnread, onInspect, preview, equipLinks, previewHidden, reducedMotion, hoverAnchor = null, ownSeats }: TagDrawersProps) {
  const { pane, setPane, close, pinAnchor } = hud;
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

  const [chainShown, setChainShown] = useState(false);
  useEffect(() => { if (!chainOpen || pane != null) setChainShown(false); }, [chainOpen, pane]);
  const leftPanes = LEFT_TAB_ORDER.filter((id) => id !== "camera" || hud.dock.includes("camera"));
  const rootRef = useRef<HTMLDivElement>(null);
  const heights = useLeftTabHeights(rootRef, [leftPanes.length, chainOpen, logUnread, chain.length]);

  return (
    <div ref={rootRef} style={{ display: "contents" }} data-testid="hud-drawers">
      {leftPanes.map((id, index) => (
        <LeftDrawer
          key={id}
          id={id}
          offset={leftTabOffset(index, heights)}
          open={pane === id}
          onOpen={(next) => (next ? setPane(id) : pane === id ? setPane(null) : undefined)}
          attention={id === "log" && logUnread > 0}
          count={id === "log" ? logUnread : undefined}
        >
          {panels[id]}
        </LeftDrawer>
      ))}
      {chainOpen ? (
        <div data-hud-keep="" style={{ display: "contents" }} data-testid="hud-drawer-chain">
          <EdgeDrawer
            side="left"
            label="Chain"
            icon={<Link2 strokeWidth={1.75} />}
            tone="gold"
            attention
            count={chain.length}
            open={chainShown}
            className={chainShown ? styles.open : undefined}
            onOpenChange={(open) => {
              if (open) close();
              setChainShown(open);
            }}
            size={LEFT_SIZE.chain}
            tabOffset={leftTabOffset(leftPanes.length, heights)}
          >
            <PaneHead title="Chain" onClose={() => setChainShown(false)} />
            <div className={styles.chainHost}>
              <ChainTower chain={chain} nameOf={nameOf} tones={seatTones} />
            </div>
          </EdgeDrawer>
        </div>
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
    </div>
  );
}

function LeftDrawer({ id, offset, open, onOpen, attention, count, children }: {
  id: LeftPane;
  offset: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  attention: boolean;
  count?: number;
  children: ReactNode;
}) {
  const shown = useLinger(open);
  // The log and the camera keep their rows and state while shut; the card and settings panes mount only while in view.
  const keep = id === "log" || id === "camera";
  const title = HUD_PANE_LABEL[id as HudPane];
  return (
    <div data-hud-keep="" style={{ display: "contents" }} data-testid={`hud-drawer-${id}`}>
      <EdgeDrawer
        side="left"
        label={title}
        icon={LEFT_ICON[id]}
        attention={attention}
        count={count}
        shortcut={id === "log" ? "l" : undefined}
        hoverOpen={id !== "settings"}
        open={open}
        className={open ? styles.open : undefined}
        onOpenChange={onOpen}
        size={LEFT_SIZE[id]}
        tabOffset={offset}
      >
        <PaneHead title={title} onClose={() => onOpen(false)} />
        <div className={styles.body} {...cardScrollerProps(id === "card" && open)}>
          {keep || shown ? children : null}
        </div>
      </EdgeDrawer>
    </div>
  );
}
