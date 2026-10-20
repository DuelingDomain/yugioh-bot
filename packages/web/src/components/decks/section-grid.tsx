"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { artCountLabel } from "@/components/artwork/artwork-picker";
import { StatusLine, SvButton, Zone } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { ArtChip } from "./art-chip";
import { CardArt } from "./card-art";
import { useCardPress } from "./card-press";
import { dragCardFrom, dragCardKind, hasCardDrag, readCardDrag, writeCardDrag } from "./drag";
import { genesysMark, genesysMarkText } from "./genesys";
import { GenesysBadge } from "./genesys-ui";
import { LimitBadge } from "./limit-badge";
import { MasterChip } from "./master-chip";
import {
  altArtCount,
  cardKind,
  cardLabel,
  copyKey,
  copyLimit,
  placementBlockForKind,
  sectionLimit,
  type BanlistLimits,
  type CardCatalog,
  type CardSource,
  type DeckSection,
  type SelectedStack,
} from "./model";
import styles from "./editor.module.css";
import { DeckSizeMeter, sizeState } from "./size-meter";

/** A section that holds cards it does not take (old saves, imports): a message and a one-click fix. */
export interface SectionWarning {
  message: string;
  /** No label, no button: the message is all there is to say. */
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}

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
  warning,
  emptyHint,
  children,
  onSelect,
  onHover,
  onRemove,
  onMoveSide,
  onCopy,
  copyable = true,
  onDrop,
  onArtMenu,
  artMenu,
  canMaster,
  onMaster,
  genesys = false,
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
  warning?: SectionWarning;
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
  /** False in Domain, where a deck is singleton: the + key does nothing and is not listed. */
  copyable?: boolean;
  onDrop: (source: CardSource, section: DeckSection, at?: number) => void;
  /** Right-click, long press or the menu key on a card: the art menu opens beside `anchor`. */
  onArtMenu: (request: { section: DeckSection; index: number; code: number; anchor: HTMLElement }) => void;
  /** The copy whose art menu is open. */
  artMenu: { section: string; index: number } | null;
  /** Domain only: whether a card may be the Deck Master (the rule lives in `canBeDeckMaster`). With `onMaster`, eligible tiles get a crown and the M key. */
  canMaster?: (code: number) => boolean;
  /** The M key or the crown: the copy becomes the Deck Master. */
  onMaster?: (copy: { code: number; section: DeckSection }) => void;
  /** Genesys on: tiles show points instead of banlist marks, and Link and Pendulum tiles are marked. */
  genesys?: boolean;
}) {
  const [dropping, setDropping] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  // Why the card being dragged over this section is refused; the section shows it until the drag leaves.
  const [refusal, setRefusal] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const press = useCardPress();
  const state = sizeState(codes.length, minimum, maximum);
  // The hard limit (60 Main, 15 Extra, 15 Side): at it, the section takes no new card.
  const full = codes.length >= sectionLimit(section);
  const fullNote = full ? `${title} Deck is full (${sectionLimit(section)}/${sectionLimit(section)})` : null;
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
    const kind = dragCardKind(event);
    const block = kind ? placementBlockForKind(kind, section) : null;
    if (block) {
      // No preventDefault: the browser shows "not allowed" and never sends the drop.
      event.dataTransfer.dropEffect = "none";
      setRefusal(block);
      return false;
    }
    // A card from the list, the Deck Master slot or another section is new here; a card moved inside the section is not.
    if (full && dragCardFrom(event) !== section) {
      event.dataTransfer.dropEffect = "none";
      setRefusal(`${title} Deck is full (${sectionLimit(section)}/${sectionLimit(section)}).`);
      return false;
    }
    setRefusal(null);
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
    return true;
  }

  function finishDrop(event: DragEvent, at?: number) {
    setRefusal(null);
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
      data-section={section}
      data-unused={unused ? "" : undefined}
      data-dropping={dropping ? "true" : undefined}
      data-refused={refusal ? "true" : undefined}
      onDragOver={(event) => { if (allowDrop(event)) setDropping(true); }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setRefusal(null);
        setDropping(false);
        setInsertAt(null);
      }}
      onDrop={(event) => finishDrop(event)}
    >
      <header className={styles["de-sh"]} data-off={unused ? "" : undefined}>
        <h2 className={styles["de-st"]} tabIndex={-1}>{title}</h2>
        <span className={cn("num", styles["de-n"])} data-s={state} data-zero={codes.length === 0 ? "" : undefined}>{codes.length}</span>
        {unused ? null : <DeckSizeMeter title={title} count={codes.length} minimum={minimum} maximum={maximum} />}
        <span className={styles["de-tg"]}>{target}</span>
        {fullNote ? <span className={styles["de-full"]} role="status" data-testid={`${section}-full`}>{fullNote}</span> : null}
        {state !== "ok" ? <span className={styles["de-off"]} data-s={state}>{difference} {state === "under" ? "short" : "over"}</span> : null}
        {actions ? <div className={styles["de-clear"]}>{actions}</div> : null}
      </header>

      {refusal ? <p className={styles["de-refuse"]} aria-hidden="true">{refusal}</p> : null}

      {warning ? (
        <div className={styles["de-alert"]} role="status">
          <StatusLine tone="warn">{warning.message}</StatusLine>
          {warning.actionLabel && warning.onAction ? <SvButton variant="quiet" disabled={warning.disabled} onClick={warning.onAction}>{warning.actionLabel}</SvButton> : null}
        </div>
      ) : null}

      {children}

      {codes.length === 0 ? (
        <div className={styles["de-empty"]} data-fit-area>
          <span className={styles["de-empty-zones"]} aria-hidden="true">
            <Zone state="empty" size="md" />
            <Zone state="empty" size="md" />
            <Zone state="empty" size="md" />
          </span>
          <p><span className={styles["de-empty-wide"]}>{emptyHint}</span><span className={styles["de-empty-phone"]}>Add cards from the Cards tab.</span></p>
        </div>
      ) : (
        <ul ref={listRef} className={styles["de-grid"]} data-fit-area>
          {codes.map((code, index) => {
            const name = cardLabel(code, catalog);
            const missing = unknown.has(code);
            const isSelected = selected?.section === section && selected.code === code && (selected.index == null || selected.index === index);
            const isOver = over.has(copyKey(code, catalog));
            const arts = altArtCount(code, catalog);
            const menuOpen = artMenu?.section === section && artMenu.index === index;
            const masterable = !!onMaster && !!canMaster?.(code);
            const gMark = genesys ? genesysMark(catalog.get(code)) : null;
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
                  aria-keyshortcuts={`Delete${copyable ? " Plus =" : ""}${masterable ? " M" : ""} ContextMenu Shift+F10`}
                  aria-label={`${name}, ${title} Deck card ${index + 1}${missing ? ", not in the card database" : ""}${isOver ? ", too many copies" : ""}${gMark ? `, ${genesysMarkText(gMark)}` : ""}${arts > 0 ? `, ${artCountLabel(arts)}` : ""}`}
                  title={name}
                  data-unknown={missing ? "true" : undefined}
                  data-over={isOver ? "true" : undefined}
                  data-gx={gMark?.kind === "forbidden" ? "forbidden" : undefined}
                  draggable
                  {...gesture}
                  onPointerEnter={(event) => { if (event.pointerType !== "touch") onHover({ section, index }); }}
                  onPointerLeave={() => onHover(null)}
                  onDragStart={(event) => {
                    gesture.onDragStart();
                    onSelect({ section, code, index }, false);
                    const card = catalog.get(code);
                    writeCardDrag(event, { code, from: section, index }, card ? cardKind(card) : undefined);
                  }}
                  onKeyDown={(event) => {
                    gesture.onKeyDown(event);
                    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
                    if (event.key === "Delete" || event.key === "Backspace" || event.key === "-") {
                      event.preventDefault();
                      removeAndRefocus(code, index);
                    } else if (masterable && (event.key === "m" || event.key === "M")) {
                      event.preventDefault();
                      // A held key repeats; one press sets the Master once.
                      if (!event.repeat) onMaster({ code, section });
                    } else if (copyable && (event.key === "+" || event.key === "=")) {
                      event.preventDefault();
                      // A held key repeats; one press adds one copy.
                      if (!event.repeat) onCopy({ code, section, index });
                    }
                  }}
                >
                  <CardArt code={code} name={name} />
                  {genesys ? <GenesysBadge card={catalog.get(code)} /> : <LimitBadge limit={copyLimit(code, catalog, limits)} />}
                  <ArtChip otherArts={arts} corner open={menuOpen} onOpen={(anchor) => openMenu(anchor, code, index)} />
                  {masterable ? <MasterChip name={name} onSet={() => onMaster({ code, section })} genesys={genesys} /> : null}
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
