"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type FocusEvent, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { SheetPortal } from "@/components/sheet";
import { CardBottomSheet } from "./card-bottom-sheet";
import { CardArt } from "./card-art";
import { CardPreview } from "./card-preview";
import { groupCopies } from "./bulk-import";
import type { ImportPreviewRow } from "./import-api";
import styles from "./import-cards.module.css";

export type CardInfoMap = ReadonlyMap<number, DeckCardInfo>;

/** The name the lookup gave a card, or a plain stand-in while the lookup runs or when it failed. */
export function cardLabel(code: number, cards: CardInfoMap): string {
  const name = cards.get(code)?.name;
  return name && name !== `Card ${code}` ? name : `Card ${code}`;
}

/** How long the pointer rests on a thumbnail before the large card shows, so crossing a strip does not flash. */
const HOVER_DELAY = 140;
const POPOVER_WIDTH = 288;
const POPOVER_HEIGHT = (screenHeight: number) => Math.min(screenHeight - 16, 540);

type Anchor = { code: number; top: number; left: number; side: "right" | "left" };

export type ThumbBind = (code: number) => {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onClick: () => void;
};

/**
 * The large card view for the thumbnails of the whole list. A mouse resting on a thumbnail (or a keyboard
 * focus on it) shows the card beside it; a tap or click opens the same card in a sheet. Touch never opens the
 * hover view, because a tap would leave it stuck open. The card details come from the one batched lookup.
 */
export function useCardPreview(cards: CardInfoMap): { bind: ThumbBind; overlay: React.ReactNode } {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  // The newest card details, so a tap reads what is known now and never waits for a later lookup.
  const known = useRef(cards);
  known.current = cards;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    setAnchor(null);
  }, []);
  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current); }, []);

  const show = useCallback((code: number, target: HTMLElement, delay: number) => {
    if (timer.current != null) clearTimeout(timer.current);
    const open = () => {
      const rect = target.getBoundingClientRect();
      const right = rect.right + 12 + POPOVER_WIDTH <= window.innerWidth;
      // The card is centered on the thumbnail and kept inside the screen.
      const half = POPOVER_HEIGHT(window.innerHeight) / 2;
      const middle = rect.top + rect.height / 2;
      setAnchor({
        code,
        top: Math.min(Math.max(middle, half + 8), window.innerHeight - half - 8),
        left: right ? rect.right + 12 : Math.max(8, rect.left - 12 - POPOVER_WIDTH),
        side: right ? "right" : "left",
      });
    };
    if (delay <= 0) open();
    else timer.current = setTimeout(open, delay);
  }, []);

  const bind = useCallback<ThumbBind>((code) => ({
    onPointerEnter: (event) => { if (event.pointerType !== "touch") show(code, event.currentTarget, HOVER_DELAY); },
    onPointerLeave: cancel,
    onFocus: (event) => { if (event.currentTarget.matches(":focus-visible")) show(code, event.currentTarget, 0); },
    onBlur: cancel,
    // Escape closes the card a focus opened, without moving the focus.
    onKeyDown: (event) => { if (event.key === "Escape") cancel(); },
    // The sheet opens only for a card that is known now. A tap before the lookup ends does nothing.
    onClick: () => { cancel(); if (known.current.has(code)) setSheet(code); },
  }), [show, cancel]);

  const hovered = anchor ? cards.get(anchor.code) : undefined;
  const opened = sheet != null ? cards.get(sheet) : undefined;
  const overlay = (
    <>
      {anchor && hovered ? (
        <SheetPortal>
          <div
            className={styles.popover}
            style={{ left: anchor.left, top: anchor.top, width: POPOVER_WIDTH, maxHeight: POPOVER_HEIGHT(window.innerHeight) }}
            data-testid="card-popover"
            aria-hidden="true"
          >
            <CardPreview card={hovered} />
          </div>
        </SheetPortal>
      ) : null}
      {opened ? (
        <CardBottomSheet label={opened.name} onClose={() => setSheet(null)}>
          <CardPreview card={opened} compact />
        </CardBottomSheet>
      ) : null}
    </>
  );
  return { bind, overlay };
}

type ThumbProps = { code: number; copies?: number; cards: CardInfoMap; bind: ThumbBind; skipTab?: boolean };

/** One card thumbnail. It is a button, so a keyboard or a tap can open the card; the art loads lazily. */
function Thumb({ code, copies = 1, cards, bind, skipTab }: ThumbProps) {
  const name = cardLabel(code, cards);
  return (
    <button
      type="button"
      className={styles.thumb}
      aria-label={copies > 1 ? `${name}, ${copies} copies` : name}
      tabIndex={skipTab ? -1 : undefined}
      {...bind(code)}
    >
      <CardArt code={code} name={name} />
      {copies > 1 ? <span className={styles.copies} aria-hidden="true">×{copies}</span> : null}
    </button>
  );
}

/** The row icon: the Deck Master's art, or the first Main card when there is no Master. */
export function RowIcon({ row, cards, bind }: { row: ImportPreviewRow; cards: CardInfoMap; bind: ThumbBind }) {
  const code = row.deck.deckMaster ?? row.deck.main[0] ?? row.deck.extra[0] ?? row.deck.side[0];
  if (code == null) return <span className={styles.iconEmpty} aria-hidden="true" />;
  const name = cardLabel(code, cards);
  // The same card is in the strip as a real button, so the icon is only a mouse and touch shortcut to it.
  return (
    <button type="button" className={`${styles.thumb} ${styles.icon}`} data-icon={row.deck.deckMaster != null ? "master" : "first"} tabIndex={-1} aria-hidden="true" {...bind(code)}>
      <CardArt code={code} name={name} />
    </button>
  );
}

/** "Master <small art> <name>". Nothing at all when the deck has no Deck Master. */
export function MasterLabel({ code, cards, bind }: { code: number | null; cards: CardInfoMap; bind: ThumbBind }) {
  if (code == null) return null;
  const name = cardLabel(code, cards);
  return (
    <span className={styles.master}>
      Master
      <button type="button" className={`${styles.thumb} ${styles.mini}`} aria-label={`Deck Master art: ${name}`} {...bind(code)}>
        <CardArt code={code} name={name} />
      </button>
      <b className={styles.masterName}>{name}</b>
    </span>
  );
}

const SECTIONS = [
  { key: "main", label: "Main" },
  { key: "extra", label: "Extra" },
  { key: "side", label: "Side" },
] as const;

/** Distinct cards shown in the collapsed strip. The strip clips, so a narrow screen shows fewer. */
const STRIP_CARDS = 14;

/**
 * A compact strip of the deck's cards (Main, then Extra, then Side). The strip is for the mouse and touch;
 * "Show all cards" is the keyboard way to every card, so a long list has few Tab stops. Expanded, the whole deck shows by
 * section, one thumbnail per distinct card with its copy count.
 */
export function CardStrip({ row, cards, bind, label }: { row: ImportPreviewRow; cards: CardInfoMap; bind: ThumbBind; label: string }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const groups = SECTIONS.map(({ key, label: title }) => ({ key, title, cards: groupCopies(row.deck[key]), total: row.deck[key].length }));
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  if (total === 0) return null;
  // One thumbnail per distinct card, even when a card is in more than one section.
  const flat = [...new Map(groups.flatMap((group) => group.cards).map((card) => [card.code, card])).values()].slice(0, STRIP_CARDS);
  return (
    <div className={styles.cards}>
      <div className={styles.head}>
        {open ? null : (
          <div className={styles.strip} role="group" aria-label={`Cards in ${label}`}>
            {flat.map(({ code }) => <Thumb key={code} code={code} cards={cards} bind={bind} skipTab />)}
          </div>
        )}
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide cards" : "Show all cards"}
          <ChevronDown size={14} aria-hidden="true" className={styles.caret} />
        </button>
      </div>
      {open ? (
        <div id={regionId} className={styles.full}>
          {groups.filter((group) => group.total > 0).map((group) => (
            <section key={group.key} aria-label={`${group.title}, ${group.total} cards`}>
              <h4 className={styles.sectionHead}>{group.title} <b className="num">{group.total}</b></h4>
              <div className={styles.grid}>
                {group.cards.map(({ code, copies }) => <Thumb key={code} code={code} copies={copies} cards={cards} bind={bind} />)}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
