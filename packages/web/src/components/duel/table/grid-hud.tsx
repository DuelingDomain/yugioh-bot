"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link2, ScrollText, SlidersHorizontal, Video, X } from "lucide-react";
import type { DuelChainLink } from "@yugidraft/shared/duels";
import { cardArtUrl } from "../constants";
import { unreadLabel } from "../side-panel";
import styles from "./grid-hud.module.css";

/**
 * The floating HUD of the 4-way grid table (concept B): an icon dock at the top left, the flyout it opens over the
 * board, and the chain tower that shows under the dock while a chain is live. The parts below hold no duel state of
 * their own; the shell owns which pane is open and feeds each part its real data.
 */

/**
 * The panes the HUD can open. `master`, `other` and `card` are not dock icons: a Deck Master token and a card click open
 * them. `camera` is the fourth dock icon of the Tag Rooftop only (its camera dock).
 */
export type HudPane = "card" | "log" | "settings" | "chain" | "master" | "other" | "camera";

export const DOCK_PANES = ["log", "settings", "chain"] as const;
/** The dock of a table with a camera panel. */
export const DOCK_PANES_CAMERA = [...DOCK_PANES, "camera"] as const;
/** A dock icon. */
export type DockPane = (typeof DOCK_PANES_CAMERA)[number];

export const HUD_PANE_LABEL: Record<HudPane, string> = {
  card: "Card",
  log: "Log",
  settings: "Settings",
  chain: "Chain",
  master: "Deck Master",
  other: "Deck Master",
  camera: "Camera",
};

type SeatTones = ReadonlyMap<number, { main: string; ink: string }>;

const DOCK_ICON = { log: ScrollText, settings: SlidersHorizontal, chain: Link2, camera: Video } as const;

/**
 * Closes the open flyout with Esc or a press outside the parts marked `data-hud-keep`. A card menu or the pile viewer
 * (`suspended`) keeps Esc for itself, and so does an open modal dialog (Surrender). This listener does not run before
 * every other key handler: the prompt panel's capture listener on the window is older and runs first, so a shell passes
 * it "a flyout is open" as `escapeHeld` (it then ignores Esc only) instead of relying on `stopPropagation` here.
 */
export function useHudDismiss(active: boolean, suspended: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || suspended) return;
      // A modal dialog (Surrender) owns its Esc: the flyout stays shut behind it and the modal gets the key.
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    const onDown = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-hud-keep]")) return;
      close.current();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [active, suspended]);
}

export function GridDock({ pane, onToggle, unread, chainCount, panes = DOCK_PANES }: {
  pane: HudPane | null;
  /** The icons, top to bottom. Default: Log, Settings, Chain. */
  panes?: readonly DockPane[];
  /** The same icon again closes the pane. */
  onToggle: (pane: HudPane) => void;
  /** New log rows since the Log pane was last in view. */
  unread: number;
  chainCount: number;
}) {
  return (
    <nav className={styles.dock} aria-label="Table panels" data-hud-keep="" data-testid="hud-dock">
      {panes.map((id) => {
        const Icon = DOCK_ICON[id];
        const count = id === "log" ? unread : id === "chain" ? chainCount : 0;
        return (
          <button key={id} type="button" className={styles.dockButton} data-pane={id} data-testid={`hud-dock-${id}`}
            aria-label={HUD_PANE_LABEL[id]} aria-pressed={pane === id} aria-expanded={pane === id}
            title={HUD_PANE_LABEL[id]} onClick={() => onToggle(id)}>
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            {count > 0 ? (
              <>
                <span className={styles.dockBadge} data-kind={id} data-testid={`hud-badge-${id}`} aria-hidden="true">{unreadLabel(count)}</span>
                <span className="sr-only">, {count} {id === "chain" ? (count === 1 ? "link" : "links") : count === 1 ? "new event" : "new events"}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The flyout: tabs on top, the open pane under them. A pane in `keepMounted` stays mounted while hidden (the log keeps
 * the rows it has built and counts the new ones); the others mount only while shown.
 */
export function GridFlyout({ pane, tabs, panels, keepMounted, onSelect, onClose, chainCount, chainLive }: {
  pane: HudPane | null;
  tabs: readonly HudPane[];
  panels: Partial<Record<HudPane, ReactNode>>;
  keepMounted: readonly HudPane[];
  onSelect: (pane: HudPane) => void;
  onClose: () => void;
  chainCount: number;
  /** A chain is live: the flyout opens clear of the chain tower. */
  chainLive: boolean;
}) {
  const open = pane != null && pane !== "master" && pane !== "other";
  const shown = open ? pane : null;
  return (
    <aside className={styles.flyout} hidden={!open} data-open={open ? "true" : "false"} data-pane={shown ?? undefined}
      data-chain={chainLive ? "true" : undefined} data-hud-keep="" data-testid="hud-flyout"
      role="dialog" aria-label={shown ? `${HUD_PANE_LABEL[shown]} panel` : "Table panel"}>
      <div className={styles.flyTabs} role="tablist" aria-label="Table panels">
        {tabs.map((id) => (
          <button key={id} type="button" role="tab" id={`hud-tab-${id}`} aria-selected={shown === id} aria-controls={`hud-panel-${id}`}
            tabIndex={shown === id ? 0 : -1} data-testid={`hud-tab-${id}`} onClick={() => onSelect(id)}>
            {HUD_PANE_LABEL[id]}
            {id === "chain" && chainCount > 0 ? <span className={styles.tabBadge} aria-hidden="true">{chainCount}</span> : null}
          </button>
        ))}
        <button type="button" className={styles.flyClose} aria-label="Close panel" data-testid="hud-close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className={styles.flyBody}>
        {tabs.map((id) => {
          const active = shown === id;
          if (!active && !keepMounted.includes(id)) return null;
          return (
            <div key={id} className={styles.flyPanel} id={`hud-panel-${id}`} role="tabpanel" aria-labelledby={`hud-tab-${id}`} hidden={!active}>
              {panels[id]}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function toneVars(tones: SeatTones | undefined, seat: number): CSSProperties | undefined {
  const tone = tones?.get(seat);
  return tone ? ({ "--seat-main": tone.main, "--seat-ink": tone.ink } as CSSProperties) : undefined;
}

/** One link of a chain, newest first (the link that resolves first is on top). */
function ChainRow({ link, nameOf, tones, detail }: { link: DuelChainLink; nameOf: (seat: number) => string; tones?: SeatTones; detail: boolean }) {
  const targets = link.targets?.length ?? 0;
  return (
    <li className={styles.chainRow} data-testid="chain-row" data-link={link.index} style={toneVars(tones, link.seat)}>
      <span className={styles.chainArt} style={link.code != null ? { backgroundImage: `url(${cardArtUrl(link.code)})` } : undefined} aria-hidden="true">
        <u>{link.index}</u>
      </span>
      <span className={styles.chainText}>
        <b>{link.name ?? "A card"}</b>
        <small>{nameOf(link.seat)}{targets > 0 ? ` · target ${targets}` : ""}</small>
        {detail && link.description ? <em>{link.description}</em> : null}
      </span>
    </li>
  );
}

/** The Chain pane: every link with its owner, targets and effect text. */
export function ChainList({ chain, nameOf, tones }: { chain: readonly DuelChainLink[]; nameOf: (seat: number) => string; tones?: SeatTones }) {
  if (chain.length === 0) return <p className={styles.empty}>No chain is open.</p>;
  const ordered = [...chain].sort((a, b) => b.index - a.index);
  return (
    <div className={styles.chainPane}>
      <p className={styles.chainHead}>{chain.length === 1 ? "1 link" : `${chain.length} links`}, resolves {chain.length > 1 ? `${ordered[0].index} to ${ordered[ordered.length - 1].index}` : "now"}</p>
      <ol className={styles.chainList}>
        {ordered.map((link) => <ChainRow key={link.index} link={link} nameOf={nameOf} tones={tones} detail />)}
      </ol>
    </div>
  );
}

const TOWER_ROWS = 4;

/**
 * The chain tower: under the dock, there while a chain is live whatever pane is open. Newest link first. A click opens
 * the Chain pane.
 */
export function ChainTower({ chain, nameOf, tones, onOpen }: { chain: readonly DuelChainLink[]; nameOf: (seat: number) => string; tones?: SeatTones; onOpen: () => void }) {
  if (chain.length === 0) return null;
  const ordered = [...chain].sort((a, b) => b.index - a.index);
  const hidden = Math.max(0, ordered.length - TOWER_ROWS);
  return (
    <section className={styles.tower} aria-label="Chain" data-testid="chain-tower" data-links={chain.length}>
      <button type="button" className={styles.towerHead} onClick={onOpen} aria-label={`Chain, ${chain.length} ${chain.length === 1 ? "link" : "links"}. Open the Chain panel`} data-hud-keep="">
        <Link2 size={14} strokeWidth={1.75} aria-hidden />
        <span>Chain · {chain.length} {chain.length === 1 ? "link" : "links"}</span>
      </button>
      <ol className={styles.chainList}>
        {ordered.slice(0, TOWER_ROWS).map((link) => <ChainRow key={link.index} link={link} nameOf={nameOf} tones={tones} detail={false} />)}
      </ol>
      {hidden > 0 ? <p className={styles.towerMore}>+{hidden} more</p> : null}
    </section>
  );
}
