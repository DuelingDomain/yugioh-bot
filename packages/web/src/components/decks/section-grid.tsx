"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { artCountLabel } from "@/components/artwork/artwork-picker";
import { Zone } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { ArtChip } from "./art-chip";
import { CardArt } from "./card-art";
import { useCardPress } from "./card-press";
import { hasCardDrag, readCardDrag, writeCardDrag } from "./drag";
import { LimitBadge } from "./limit-badge";
import {
  altArtCount,
  cardLabel,
  copyKey,
  copyLimit,
  type BanlistLimits,
  type CardCatalog,
  type CardSource,
  type DeckSection,
  type SelectedStack,
} from "./model";
import styles from "./editor.module.css";
import { DeckSizeMeter, sizeState } from "./size-meter";

export type CountTone = "ok" | "warn" | "bad";
/** One deck copy under the pointer. */
export type HoveredCopy = { section: DeckSection; index: number };

export function DeckSectionGrid({
  title,
  section,
  codes,
  target,
  minimum = 0,
  maximum = 15,
  unused = false,
  catalog,
  unknown,
  limits,
  over,
  selected,
  actions,
  emptyHint,
  children,
  onSelect,
  onHover,
  onRemove,
  onMoveSide,
  onCopy,
  onDrop,
  onArtMenu,
  artMenu,
}: {
  title: string;
  section: DeckSection;
  codes: number[];
  target: string;
  minimum?: number;
  maximum?: number;
  unused?: boolean;
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
  onSelect: (stack: SelectedStack, openSheet?: boolean) => void;
  onHover: (copy: HoveredCopy | null) => void;
  /** Left-click: takes the copy out of the deck. */
  onRemove: (source: CardSource) => void;
  /** Ctrl+click or Cmd+click: the copy goes to the Side Deck, or from the Side Deck to where it belongs. */
  onMoveSide: (source: CardSource & { from: DeckSection; index: number }) => void;
  /** Ctrl+right-click or the + key: one more copy of this card, art included, goes into the same section next to it. */
  onCopy: (copy: { code: number; section: DeckSection; index: number }) => void;
  onDrop: (source: CardSource, section: DeckSection, at?: number) => void;
  /** Right-click, long press or the menu key on a card: the art menu opens beside `anchor`. */
  onArtMenu: (request: { section: DeckSection; index: number; code: number; anchor: HTMLElement }) => void;
  /** The copy whose art menu is open. */
  artMenu: { section: string; index: number } | null;
}) {
  const [dropping, setDropping] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const press = useCardPress();
  const state = sizeState(codes.length, minimum, maximum);
  const difference = state === "under" ? minimum - codes.length : codes.length - maximum;

  /** Removes a copy and keeps focus on the card that takes its place. */
  function removeAndRefocus(code: number, index: number) {
    onRemove({ code, from: section, index });
    requestAnimationFrame(() => {
      const items = listRef.current?.children;
      if (!items || items.length === 0) return;
      items[Math.min(index, items.length - 1)]?.querySelector("button")?.focus();
    });
  }

  function openMenu(anchor: HTMLElement, code: number, index: number) {
    onArtMenu({ section, index, code, anchor });
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
      className={styles["de-sec-b"]}
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
      <header className={styles["de-sh"]} data-off={unused ? "" : undefined}>
        <h2 className={styles["de-st"]}>{title}</h2>
        <span className={cn("num", styles["de-n"])} data-s={state} data-zero={codes.length === 0 ? "" : undefined}>{codes.length}</span>
        {unused ? null : <DeckSizeMeter title={title} count={codes.length} minimum={minimum} maximum={maximum} />}
        <span className={styles["de-tg"]}>{target}</span>
        {state !== "ok" ? <span className={styles["de-off"]} data-s={state}>{difference} {state === "under" ? "short" : "over"}</span> : null}
        {actions ? <div className={styles["de-clear"]}>{actions}</div> : null}
      </header>

      {children}

      {codes.length === 0 ? (
        <div className={styles["de-empty"]}>
          <span className={styles["de-empty-zones"]} aria-hidden="true">
            <Zone state="empty" size="md" />
            <Zone state="empty" size="md" />
            <Zone state="empty" size="md" />
          </span>
          <p><span className={styles["de-empty-wide"]}>{emptyHint}</span><span className={styles["de-empty-phone"]}>Add cards from the Cards tab.</span></p>
        </div>
      ) : (
        <ul ref={listRef} className={styles["de-grid"]}>
          {codes.map((code, index) => {
            const name = cardLabel(code, catalog);
            const missing = unknown.has(code);
            const isSelected = selected?.section === section && selected.code === code && (selected.index == null || selected.index === index);
            const isOver = over.has(copyKey(code, catalog));
            const arts = altArtCount(code, catalog);
            const menuOpen = artMenu?.section === section && artMenu.index === index;
            const gesture = press({
              remove: () => removeAndRefocus(code, index),
              moveSide: () => onMoveSide({ code, from: section, index }),
              select: () => onSelect({ section, code, index }),
              menu: (anchor) => openMenu(anchor, code, index),
              copy: () => onCopy({ code, section, index }),
            });
            return (
              <li
                key={`${section}-${index}`}
                data-insert={insertAt === index ? "true" : undefined}
                onDragOver={(event) => { if (allowDrop(event)) { setDropping(true); setInsertAt(index); } }}
                onDrop={(event) => finishDrop(event, index)}
              >
                <button
                  type="button"
                  className={styles["de-c"]}
                  aria-pressed={isSelected}
                  aria-keyshortcuts="Delete Plus = ContextMenu Shift+F10"
                  aria-label={`${name}, ${title} Deck card ${index + 1}${missing ? ", not in the card database" : ""}${isOver ? ", too many copies" : ""}${arts > 0 ? `, ${artCountLabel(arts)}` : ""}`}
                  title={name}
                  data-unknown={missing ? "true" : undefined}
                  data-over={isOver ? "true" : undefined}
                  draggable
                  {...gesture}
                  onPointerEnter={(event) => { if (event.pointerType !== "touch") onHover({ section, index }); }}
                  onPointerLeave={() => onHover(null)}
                  onDragStart={(event) => {
                    gesture.onDragStart();
                    onSelect({ section, code, index }, false);
                    writeCardDrag(event, { code, from: section, index });
                  }}
                  onKeyDown={(event) => {
                    gesture.onKeyDown(event);
                    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
                    if (event.key === "Delete" || event.key === "Backspace" || event.key === "-") {
                      event.preventDefault();
                      removeAndRefocus(code, index);
                    } else if (event.key === "+" || event.key === "=") {
                      event.preventDefault();
                      // A held key repeats; one press adds one copy.
                      if (!event.repeat) onCopy({ code, section, index });
                    }
                  }}
                >
                  <CardArt code={code} name={name} />
                  <LimitBadge limit={copyLimit(code, catalog, limits)} />
                  <ArtChip otherArts={arts} corner open={menuOpen} onOpen={(anchor) => openMenu(anchor, code, index)} />
                  {missing ? <span className={cn("num", styles.unknownTag)}>{code}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
