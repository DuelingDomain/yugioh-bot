"use client";

// The left column of the duel room: a Card | Log | Settings tab bar and the panels it switches.
// Card is first and the default. The Log panel stays mounted while hidden, so the history list keeps
// the rows it has built and the Log tab can count what arrived while you were elsewhere.
import { useSyncExternalStore, type ReactNode } from "react";
import { MousePointer2 } from "lucide-react";
import baseRoomStyles from "./room.module.css";
import baseStyles from "./side-panel.module.css";
import { useSkinStyles } from "./skin";

/** `masters` only exists in the narrow layout; on desktop the Deck Masters have their own column. */
export type SidePane = "card" | "log" | "settings" | "masters";

export const DEFAULT_SIDE_PANE: SidePane = "card";

/** Tab order on desktop. Card first, so it is the selected tab on load. */
export const DESKTOP_PANES: readonly SidePane[] = ["card", "log", "settings"];

/** The narrow bottom bar has the same three tabs, then Deck Masters for a Domain duel. */
export function mobilePanes(domain: boolean): readonly SidePane[] {
  return domain ? [...DESKTOP_PANES, "masters"] : DESKTOP_PANES;
}

export const SIDE_PANE_LABEL: Record<SidePane, string> = {
  card: "Card",
  log: "Log",
  settings: "Settings",
  masters: "Masters",
};

/** A pane the desktop tab bar can show: Deck Masters is not a desktop tab. */
export function desktopPane(pane: SidePane): SidePane {
  return pane === "masters" ? DEFAULT_SIDE_PANE : pane;
}

const tabId = (pane: SidePane) => `duel-side-tab-${pane}`;
const panelId = (pane: SidePane) => `duel-side-panel-${pane}`;

const NARROW_QUERY = "(max-width: 900px)";

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function narrowNow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
}

/** True in the narrow layout, where the left column is a sheet opened from the bottom bar. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, narrowNow, () => false);
}

export function unreadLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export function SideTabs({ panes, selected, onSelect, unread = 0, mobile = false, labels }: {
  panes: readonly SidePane[];
  selected: SidePane;
  onSelect: (pane: SidePane) => void;
  /** New log rows since the Log tab was last in view. 0 hides the badge. */
  unread?: number;
  /** The bottom bar: plain buttons that open the sheet, not a tablist. */
  mobile?: boolean;
  /** Other words for some tabs (the wide table calls its Masters tab "Master"). */
  labels?: Partial<Record<SidePane, string>>;
}) {
  const roomStyles = useSkinStyles(baseRoomStyles, "side");
  const styles = useSkinStyles(baseStyles, "side");
  return (
    <div className={roomStyles.tabs} role={mobile ? undefined : "tablist"}
      aria-label={mobile ? "Mobile duel panels" : "Duel panels"}
      onKeyDown={(event) => {
        if (mobile || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
        buttons[next]?.click();
      }}>
      {panes.map((tab) => (
        <button key={tab} type="button" id={mobile ? undefined : tabId(tab)}
          role={mobile ? undefined : "tab"}
          aria-selected={mobile ? undefined : selected === tab}
          aria-controls={mobile ? undefined : panelId(tab)}
          aria-haspopup={mobile ? "dialog" : undefined}
          tabIndex={mobile || selected === tab ? 0 : -1}
          onClick={() => onSelect(tab)}>
          {labels?.[tab] ?? SIDE_PANE_LABEL[tab]}
          {tab === "log" && unread > 0 ? (
            <>
              <span className={styles.badge} data-testid="log-unread" aria-hidden="true">{unreadLabel(unread)}</span>
              <span className="sr-only">, {unread} new {unread === 1 ? "event" : "events"}</span>
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * One panel of the column. `semantic` panels sit under the desktop tablist (role=tabpanel, labelled by
 * their tab); the narrow sheet has no tablist, so its panels are plain. A panel that is not selected is
 * unmounted, unless `keepMounted` hides it instead.
 */
export function SidePanel({ pane, selected, semantic = true, keepMounted = false, children }: {
  pane: SidePane;
  selected: SidePane;
  semantic?: boolean;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const styles = useSkinStyles(baseStyles, "side");
  const active = selected === pane;
  if (!active && !keepMounted) return null;
  return (
    <div className={styles.panel} hidden={!active}
      id={semantic ? panelId(pane) : undefined}
      role={semantic ? "tabpanel" : undefined}
      aria-labelledby={semantic ? tabId(pane) : undefined}>
      {children}
    </div>
  );
}

/** The Card tab before any card is hovered or clicked. */
export function CardTabEmpty() {
  const styles = useSkinStyles(baseStyles, "side");
  return (
    <div className={styles.empty} data-testid="card-tab-empty">
      <MousePointer2 size={22} strokeWidth={1.5} aria-hidden />
      <p>Hover or click a card to see it here</p>
    </div>
  );
}
