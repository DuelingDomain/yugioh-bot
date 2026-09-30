"use client";

import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { cardArtUrl } from "@/components/duel/constants";
import { cx } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { cardLabel, type DeckSection, type SelectedStack } from "./model";
import styles from "./editor.module.css";

export function DeckSectionGrid({
  title,
  section,
  codes,
  target,
  catalog,
  unknown,
  selected,
  onSelect,
}: {
  title: string;
  section: DeckSection;
  codes: number[];
  target?: string;
  catalog: ReadonlyMap<number, DuelCardInfo>;
  unknown: ReadonlySet<number>;
  selected: SelectedStack | null;
  onSelect: (stack: SelectedStack) => void;
}) {
  return (
    <section className={styles.list} aria-label={`${title} deck`}>
      <h3 className={styles.listHead}>
        <span className={styles.listTitle}>{title}</span>
        <span className={cx(ui.num, styles.count)}>{codes.length}</span>
        {target ? <span className={styles.target}>{target}</span> : null}
      </h3>
      {codes.length === 0 ? (
        <p className={styles.empty}>Empty</p>
      ) : (
        <ul className={styles.cards}>
          {codes.map((code, index) => {
            const name = cardLabel(code, catalog);
            const missing = unknown.has(code);
            const isSelected = selected?.section === section && selected.code === code;
            return (
              <li key={`${section}-${index}-${code}`}>
                <button
                  type="button"
                  className={styles.card}
                  aria-pressed={isSelected}
                  aria-label={`${name} in ${title}, card ${index + 1}${missing ? ", unavailable in catalog" : ""}`}
                  data-unknown={missing ? "true" : undefined}
                  onClick={() => onSelect({ section, code })}
                >
                  <img src={cardArtUrl(code, "small")} alt="" loading="lazy" />
                  {missing ? <span className={styles.unknownTag}>Unknown</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
