"use client";

import { useId, type CSSProperties } from "react";
import type { DuelMode, GenesysCard, GenesysSettings, SavedDeck } from "@yugidraft/shared/duels";
import { formatLabel } from "../decks/genesys";
import { genesysPlainLine, savedDeckGenesysPick, savedDeckTag, type GenesysPick } from "./saved-deck-genesys";
import ui from "./sheet-ui.module.css";
import styles from "./saved-deck-genesys.module.css";

export interface GenesysDeckRowModel {
  saved: SavedDeck;
  /** null for a deck of the other format. */
  pick: GenesysPick | null;
}

/** One row per saved deck of the room's format, judged against the cap; decks of the other format follow. */
export function genesysDeckRows(
  decks: readonly SavedDeck[],
  mode: DuelMode,
  genesys: GenesysSettings,
  catalog: ReadonlyMap<number, GenesysCard>,
  settled: ReadonlySet<number>,
  failed: boolean,
): GenesysDeckRowModel[] {
  const same = decks.filter((saved) => saved.mode === mode);
  // A stable sort: the tagged decks come first, and inside each group the list keeps its order.
  const sorted = [...same].sort((a, b) => Number(Boolean(b.genesys)) - Number(Boolean(a.genesys)));
  return [
    ...sorted.map((saved) => ({ saved, pick: savedDeckGenesysPick(saved.deck, mode, catalog, genesys, settled, failed) })),
    ...decks.filter((saved) => saved.mode !== mode).map((saved) => ({ saved, pick: null })),
  ];
}

/**
 * The deck choice of a Genesys room. A deck that does not fit the cap now is disabled and says why; when the host
 * raises the cap the rows are judged again, so a deck that fits becomes pickable at once.
 */
export function GenesysDeckChoices({ mode, genesys, rows, picked, disabled, emptyText, onPick }: {
  mode: DuelMode;
  genesys: GenesysSettings;
  rows: readonly GenesysDeckRowModel[];
  picked: string;
  disabled: boolean;
  /** Shown when there is no row: loading, an error or no deck in this format. */
  emptyText: string;
  onPick: (id: string) => void;
}) {
  const name = useId();
  return (
    <div className={styles.wrap}>
      <p className={styles.plain}>{genesysPlainLine(mode)}</p>
      <fieldset className={styles.group} disabled={disabled}>
        <legend className={styles.legend}>Use a saved deck · cap {genesys.pointCap} pts</legend>
        {rows.length === 0 ? <p className={styles.empty}>{emptyText}</p> : null}
        <div className={styles.scroll}>
          {rows.map(({ saved, pick }) => {
            const id = String(saved.id);
            const isPicked = picked === id;
            const blocked = pick ? !pick.selectable : true;
            const state = pick?.state ?? "other";
            const reason = pick ? pick.reason : `Saved as ${formatLabel(saved.mode, saved.genesys)}. Not usable in a ${formatLabel(mode, genesys)} room.`;
            const tag = pick ? savedDeckTag(saved) || "Not tagged Genesys" : "";
            const whyId = `${name}-${id}`;
            return (
              <label key={id} className={styles.row} data-s={state} data-picked={isPicked} data-blocked={blocked} data-testid="genesys-deck-row">
                <input type="radio" className={ui.srOnly} name={name} value={id}
                  checked={isPicked} disabled={blocked && !isPicked}
                  aria-describedby={reason ? whyId : undefined}
                  onChange={() => { if (!blocked) onPick(id); }} />
                <span className={styles.name}>
                  <strong>{saved.name}</strong>
                  <span>{`${saved.deck.main.length} Main / ${saved.deck.extra.length} Extra / ${saved.deck.side.length} Side${tag ? ` · ${tag}` : ""}`}</span>
                </span>
                {pick ? (
                  <span className={styles.pts}>
                    <span><b>{pick.totalText}</b> / {genesys.pointCap} pts</span>
                    <span className={styles.bar} aria-hidden="true"><span className={styles.fill} style={{ "--fill": `${Math.round(pick.fill * 100)}%` } as CSSProperties} /></span>
                  </span>
                ) : null}
                <span className={styles.chip}>{pick ? (isPicked && blocked ? `Loaded · ${pick.label}` : pick.label) : "Other format"}</span>
                {reason ? <span id={whyId} className={styles.why}>{reason}</span> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
