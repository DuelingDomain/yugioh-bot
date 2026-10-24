"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Plus, Search, X } from "lucide-react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { cardDetailsText } from "@/components/duel/constants";
import { cn } from "@/lib/utils";
import { pickByName, type BuilderServices } from "./api";
import { parseCardList, type PileZone } from "./board-model";
import { ADD_TARGETS, zoneName, type AddTarget } from "./placement";
import { CardThumb, writeListDrag } from "./zone-slot";
import styles from "./builder.module.css";

const PASTE_ZONES: readonly PileZone[] = ["hand", "deck", "grave", "banished", "extra"];
const HITS = 8;
const DEBOUNCE_MS = 140;

export interface QuickAddProps {
  seatLabel: string;
  services: BuilderServices;
  target: AddTarget;
  onTarget: (target: AddTarget) => void;
  armed: DeckCardInfo | null;
  /** Select a card (or clear with null). A click on an empty zone places the selected card. */
  onArm: (card: DeckCardInfo | null) => void;
  /** Enter, or the + button. `count` > 1 for `3x Name`. */
  onAdd: (card: DeckCardInfo, count: number) => void;
  /** Fill a pile from pasted text. Returns the message to show. */
  onPaste: (input: { text: string; zone: PileZone; mode: "append" | "replace" }) => Promise<string>;
  /** Tell the builder these cards are known (names and types for the board). */
  onCards: (cards: DeckCardInfo[]) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

type Hits = { key: string; cards: DeckCardInfo[]; error?: boolean };

/** The query text of a typed line: the name without a `3x` count, or the passcode. */
function queryOf(text: string): { text: string; count: number } | null {
  const line = parseCardList(text)[0];
  if (!line) return null;
  return { text: line.passcode !== undefined ? String(line.passcode) : (line.name ?? ""), count: line.count };
}

export function QuickAdd({ seatLabel, services, target, onTarget, armed, onArm, onAdd, onPaste, onCards, inputRef }: QuickAddProps) {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hits | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [moved, setMoved] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteZone, setPasteZone] = useState<PileZone>("hand");
  const [pasteMode, setPasteMode] = useState<"append" | "replace">("append");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const listId = useId();
  const ownRef = useRef<HTMLInputElement>(null);
  const field = inputRef ?? ownRef;
  const cardsRef = useRef(onCards);
  cardsRef.current = onCards;

  const query = useMemo(() => queryOf(text), [text]);
  const key = query?.text ?? "";

  useEffect(() => {
    setHighlight(0);
    setMoved(false);
    if (!key) {
      setHits(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      services.search(key, HITS, controller.signal).then(
        (cards) => {
          if (controller.signal.aborted) return;
          setHits({ key, cards });
          setLoading(false);
          cardsRef.current(cards);
        },
        () => {
          if (controller.signal.aborted) return;
          setHits({ key, cards: [], error: true });
          setLoading(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, services]);

  // The paste pile follows the target while the box is closed.
  useEffect(() => {
    if (!pasteOpen) setPasteZone(target === "field" ? "hand" : target);
  }, [target, pasteOpen]);

  const current = hits && hits.key === key ? hits.cards : [];
  const targetLabel = ADD_TARGETS.find((choice) => choice.value === target)?.label ?? zoneName("hand");

  async function submit() {
    if (!query) return;
    let cards = current;
    if (!(hits && hits.key === key)) {
      try {
        cards = await services.search(key, HITS);
        cardsRef.current(cards);
      } catch {
        cards = [];
      }
    }
    // Arrow keys pick a hit. Without them the exact name wins over the first hit.
    const card = moved ? cards[highlight] : pickByName(query.text, cards);
    if (!card) return;
    onAdd(card, query.count);
    setText("");
    field.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (current.length === 0) return;
      event.preventDefault();
      setMoved(true);
      setHighlight((index) => (index + (event.key === "ArrowDown" ? 1 : current.length - 1)) % current.length);
    } else if (event.key === "Escape") {
      if (text) {
        event.stopPropagation();
        setText("");
      } else if (armed) {
        event.stopPropagation();
        onArm(null);
      }
    }
  }

  async function applyPaste() {
    if (!pasteText.trim() || pasteBusy) return;
    setPasteBusy(true);
    try {
      setPasteMessage(await onPaste({ text: pasteText, zone: pasteZone, mode: pasteMode }));
      setPasteText("");
    } finally {
      setPasteBusy(false);
    }
  }

  const empty = key !== "" && !loading && hits?.key === key && current.length === 0;

  return (
    <section className={styles.quick} aria-label={`Add cards to ${seatLabel}`}>
      <div className={styles.quickHead}>
        <h3>Add cards to {seatLabel}</h3>
      </div>

      <div className={styles.targets} role="group" aria-label="Where Enter adds the card">
        {ADD_TARGETS.map((choice) => (
          <button key={choice.value} type="button" className={styles.targetChip} aria-pressed={target === choice.value} onClick={() => onTarget(choice.value)}>
            {choice.label}
          </button>
        ))}
      </div>

      <label className={styles.search}>
        <Search size={16} strokeWidth={1.6} aria-hidden />
        <span className="sr">Search a card to add</span>
        <input
          ref={field}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={current.length > 0}
          aria-controls={listId}
          aria-activedescendant={current.length > 0 ? `${listId}-${highlight}` : undefined}
          aria-autocomplete="list"
          placeholder={`Card name, then Enter: adds to ${targetLabel}`}
          value={text}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {text ? <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={() => { setText(""); field.current?.focus(); }}><X size={14} aria-hidden /></button> : null}
      </label>

      <p className={styles.status}>Enter adds the top hit. 3x Name adds three copies. Click a hit to select it, then click a zone.</p>

      {current.length > 0 ? (
        <ul className={styles.hits} id={listId} role="listbox" aria-label="Card hits">
          {current.map((card, index) => (
            <li
              key={card.code}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={styles.hit}
              data-highlight={index === highlight ? "true" : undefined}
              data-armed={armed?.code === card.code ? "true" : undefined}
              draggable
              onDragStart={(event) => { onCards([card]); writeListDrag(event, card.code); }}
            >
              <button type="button" className={styles.hitMain} onClick={() => { onCards([card]); onArm(armed?.code === card.code ? null : card); }}>
                <CardThumb className={styles.hitArt} code={card.code} name={card.name} />
                <span className={styles.hitText}>
                  <strong>{card.name}</strong>
                  <span>{cardDetailsText(card)}</span>
                </span>
              </button>
              <button type="button" className={styles.hitAdd} aria-label={`Add ${card.name} to ${targetLabel}`} title={`Add to ${targetLabel}`} onClick={() => { onAdd(card, query?.count ?? 1); field.current?.focus(); }}>
                <Plus size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : empty ? (
        <p className={styles.none}>{hits?.error ? "Card search failed. Try again." : "No card matches."}</p>
      ) : loading ? <p className={styles.none}>Searching…</p> : null}

      {armed ? (
        <div className={styles.armed} data-testid="armed-card">
          <CardThumb className={styles.armedArt} code={armed.code} name={armed.name} />
          <span>
            <small>Selected</small>
            <strong>{armed.name}</strong>
            <small>Click an empty zone to place it. Esc clears.</small>
          </span>
          <button type="button" className={styles.iconBtn} aria-label="Clear selected card" onClick={() => onArm(null)}><X size={14} aria-hidden /></button>
        </div>
      ) : null}

      <div className={styles.paste}>
        <button type="button" className={cn("btn btn-secondary btn-sm", styles.pasteToggle)} aria-expanded={pasteOpen} onClick={() => setPasteOpen((value) => !value)}>
          <ClipboardPaste size={14} aria-hidden /> Paste list
        </button>
        {pasteOpen ? (
          <div className={styles.pasteBox}>
            <textarea
              className="input"
              rows={6}
              aria-label="Card list, one name or passcode per line"
              placeholder={"One card per line:\nBlue-Eyes White Dragon\n3x Ash Blossom & Joyous Spring\n89631139"}
              value={pasteText}
              spellCheck={false}
              onChange={(event) => setPasteText(event.target.value)}
            />
            <div className={styles.pasteRow}>
              <label>
                <span className="sr">Put the list in</span>
                <select className="input select" value={pasteZone} onChange={(event) => setPasteZone(event.target.value as PileZone)}>
                  {PASTE_ZONES.map((zone) => <option key={zone} value={zone}>{zoneName(zone)}</option>)}
                </select>
              </label>
              <div className="seg" role="group" aria-label="Paste mode">
                <button type="button" aria-pressed={pasteMode === "append"} onClick={() => setPasteMode("append")}>Add</button>
                <button type="button" aria-pressed={pasteMode === "replace"} onClick={() => setPasteMode("replace")}>Replace</button>
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={!pasteText.trim() || pasteBusy} onClick={() => void applyPaste()}>
                {pasteBusy ? "Reading…" : "Apply"}
              </button>
            </div>
            {pasteMessage ? <p className={styles.status} role="status">{pasteMessage}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
