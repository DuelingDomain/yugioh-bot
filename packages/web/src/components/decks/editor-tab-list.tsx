"use client";

import { segmentSlide } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { TAB_LABELS, tabForKey, type EditorTab } from "./editor-tabs";
import styles from "./editor-tab-list.module.css";

type Props = {
  tabs: readonly EditorTab[];
  /** The tab on screen. */
  tab: EditorTab;
  onChange: (tab: EditorTab) => void;
  /** "seg" is the phone's segmented control at the top of the editor; "bar" is the tab bar on top of the right column. */
  variant: "seg" | "bar";
  /** Makes the ids of the tabs, so the phone and the desktop list never share one. */
  idPrefix: string;
  label: string;
  /** Main Deck count, shown on the Deck tab. */
  deckCount?: number;
  /** A deep search finished while the Bridges tab was hidden. */
  bridgesDot?: boolean;
  className?: string;
};

/** The id of the panel a tab shows. The deck and the three panes of the card list carry these ids. */
export const panelId = (tab: EditorTab) => `deck-editor-${tab}`;

/** An accessible tab list (arrow keys, Home and End) for the editor's tabs. */
export function EditorTabList({ tabs, tab, onChange, variant, idPrefix, label, deckCount, bridgesDot, className }: Props) {
  const slide = variant === "seg" ? segmentSlide(tabs.length, tabs.indexOf(tab)) : null;
  return (
    <div
      className={cn(variant === "seg" ? "seg" : styles.bar, className)}
      role="tablist"
      aria-label={label}
      data-testid={`editor-tabs-${variant}`}
      {...slide}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const next = tabForKey(tabs, tab, event.key);
        if (!next) return;
        event.preventDefault();
        onChange(next);
        document.getElementById(`${idPrefix}-${next}-tab`)?.focus();
      }}
    >
      {tabs.map((entry) => {
        const selected = entry === tab;
        const dot = entry === "bridges" && bridgesDot === true;
        return (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`${idPrefix}-${entry}-tab`}
            className={variant === "bar" ? styles.tab : undefined}
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            aria-pressed={variant === "seg" ? selected : undefined}
            aria-controls={panelId(entry)}
            data-dot={dot ? "" : undefined}
            onClick={() => onChange(entry)}
          >
            {TAB_LABELS[entry]}
            {entry === "deck" && deckCount != null ? <> <b className="num">{deckCount}</b></> : null}
            {dot ? <><span className={styles.dot} aria-hidden /><span className="sr"> (new results)</span></> : null}
          </button>
        );
      })}
    </div>
  );
}
