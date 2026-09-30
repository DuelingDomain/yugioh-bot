"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { cx } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { CardArt } from "./card-art";
import { hasCardDrag, readCardDrag, writeCardDrag } from "./drag";
import { LimitBadge } from "./limit-badge";
import {
  cardLabel,
  copyKey,
  copyLimit,
  sectionBreakdown,
  type BanlistLimits,
  type CardCatalog,
  type CardSource,
  type DeckSection,
  type SelectedStack,
} from "./model";
import styles from "./editor.module.css";

export type CountTone = "ok" | "warn" | "bad";

export function DeckSectionGrid({
  title,
  section,
  codes,
  target,
  tone,
  catalog,
  unknown,
  limits,
  over,
  selected,
  actions,
  emptyHint,
  children,
  onSelect,
  onRemove,
  onDrop,
}: {
  title: string;
  section: DeckSection;
  codes: number[];
  target: string;
  tone?: CountTone;
  catalog: CardCatalog;
  unknown: ReadonlySet<number>;
  limits: BanlistLimits | null;
  /** Copy keys (see copyKey) that break the copy limit. */
  over: ReadonlySet<string>;
  selected: SelectedStack | null;
  actions?: ReactNode;
  emptyHint: string;
  children?: ReactNode;
  onSelect: (stack: SelectedStack) => void;
  onRemove: (source: CardSource) => void;
  onDrop: (source: CardSource, section: DeckSection, at?: number) => void;
}) {
  const [dropping, setDropping] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const breakdown = sectionBreakdown(section, codes, catalog);

  /** Removes a copy from the keyboard and keeps focus on the card that takes its place. */
  function removeFromKeyboard(code: number, index: number) {
    onRemove({ code, from: section, index });
    requestAnimationFrame(() => {
      const items = listRef.current?.children;
      if (!items || items.length === 0) return;
      items[Math.min(index, items.length - 1)]?.querySelector("button")?.focus();
    });
  }

  function allowDrop(event: DragEvent): boolean {
    if (!hasCardDrag(event)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
    return true;
  }

  function finishDrop(event: DragEvent, at?: number) {
    setDropping(false);
    setInsertAt(null);
    const drag = readCardDrag(event);
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    onDrop(drag, section, at);
  }

  return (
    <section
      className={styles.section}
      aria-label={`${title} Deck`}
      data-dropping={dropping ? "true" : undefined}
      onDragOver={(event) => { if (allowDrop(event)) setDropping(true); }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropping(false);
        setInsertAt(null);
      }}
      onDrop={(event) => finishDrop(event)}
    >
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {title}
          <span className={cx(ui.num, styles.sectionCount)} data-tone={tone}>{codes.length}</span>
          <span className={styles.sectionTarget}>{target}</span>
        </h2>
        {breakdown.length > 0 ? (
          <ul className={styles.breakdown} aria-label={`${title} Deck by card type`}>
            {breakdown.map((part) => (
              <li key={part.key}>
                <span className={styles.typeDot} data-type={part.key} aria-hidden />
                {part.label} <span className={ui.num}>{part.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </header>

      {children}

      {codes.length === 0 ? (
        <p className={styles.empty}>{emptyHint}</p>
      ) : (
        <ul ref={listRef} className={styles.cards}>
          {codes.map((code, index) => {
            const name = cardLabel(code, catalog);
            const missing = unknown.has(code);
            const isSelected = selected?.section === section && selected.code === code;
            const isOver = over.has(copyKey(code, catalog));
            return (
              <li
                key={`${section}-${index}`}
                data-insert={insertAt === index ? "true" : undefined}
                onDragOver={(event) => { if (allowDrop(event)) { setDropping(true); setInsertAt(index); } }}
                onDrop={(event) => finishDrop(event, index)}
              >
                <button
                  type="button"
                  className={styles.card}
                  aria-pressed={isSelected}
                  aria-label={`${name}, ${title} Deck card ${index + 1}${missing ? ", not in the card database" : ""}${isOver ? ", too many copies" : ""}`}
                  title={name}
                  data-unknown={missing ? "true" : undefined}
                  data-over={isOver ? "true" : undefined}
                  draggable
                  onDragStart={(event) => {
                    onSelect({ section, code });
                    writeCardDrag(event, { code, from: section, index });
                  }}
                  onClick={() => onSelect({ section, code })}
                  onContextMenu={(event) => { event.preventDefault(); onRemove({ code, from: section, index }); }}
                  onKeyDown={(event) => {
                    if (event.ctrlKey || event.metaKey || event.altKey) return;
                    if (event.key === "Delete" || event.key === "Backspace" || event.key === "-") {
                      event.preventDefault();
                      removeFromKeyboard(code, index);
                    }
                  }}
                >
                  <CardArt code={code} name={name} />
                  <LimitBadge limit={copyLimit(code, catalog, limits)} />
                  {missing ? <span className={cx(ui.num, styles.unknownTag)}>{code}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
