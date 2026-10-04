"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DeckCardInfo, DuelSettings } from "@yugidraft/shared/duels";
import { Plus } from "lucide-react";
import { defaultAddSection } from "../decks/model";
import { cardArtUrl, cardKindText } from "./constants";
import { cardAddBlock, useBanlistLimits, useCardNameSearch } from "./card-add-search";
import { cx, SheetButton, SheetSelect } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./deck-editor.module.css";

type AddSection = "main" | "extra" | "side";

/** The deck editor's "Add card" row: a name or passcode field with a results dropdown, a Section select and Add. */
export function CardAddField({ settings, sideAllowed, onAdd, onError }: {
  settings: Pick<DuelSettings, "cardPool" | "validateDeck" | "banlist">;
  sideAllowed: boolean;
  onAdd: (code: number, section: AddSection) => void;
  onError: (message: string) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [section, setSection] = useState<AddSection | null>(null);
  const [added, setAdded] = useState("");

  const trimmed = query.trim();
  const isPasscode = /^\d+$/.test(trimmed);
  const { search, pending } = useCardNameSearch(query);
  const limits = useBanlistLimits(settings.banlist, settings.validateDeck, trimmed !== "");
  const cards = search?.cards ?? [];
  const blocks = cards.map((card) => cardAddBlock(card, settings, limits));
  const firstEnabled = blocks.findIndex((block) => block === null);
  // A name search selects its best allowed match; a typed passcode is added as typed unless an arrow chose a card.
  const active = picked !== null && blocks[picked] === null ? picked : isPasscode ? -1 : firstEnabled;
  const activeCard: DeckCardInfo | undefined = cards[active];
  const showPanel = open && trimmed !== "";
  const showList = showPanel && cards.length > 0;
  const chosenSection = section ?? (activeCard ? defaultAddSection(activeCard) : "main");

  useEffect(() => {
    if (showList && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [showList, active, listId]);

  function sectionFor(card?: DeckCardInfo): AddSection {
    const wanted = section ?? (card ? defaultAddSection(card) : "main");
    return wanted === "side" && !sideAllowed ? "main" : wanted;
  }

  function addCard(card: DeckCardInfo) {
    const target = sectionFor(card);
    onAdd(card.code, target);
    setAdded(`Added ${card.name} to ${target}.`);
    setQuery("");
    setPicked(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  function submit() {
    if (!trimmed) {
      onError("Enter a card name or passcode.");
      return;
    }
    if (activeCard && blocks[active] === null) {
      addCard(activeCard);
      return;
    }
    if (isPasscode) {
      const code = Number(trimmed);
      if (!Number.isSafeInteger(code) || code <= 0) {
        onError("Enter a positive passcode.");
        return;
      }
      const known = cards.findIndex((card) => card.code === code);
      if (known >= 0 && blocks[known]) {
        onError(`${cards[known].name} cannot be added: ${blocks[known]}.`);
        return;
      }
      onAdd(code, sectionFor(known >= 0 ? cards[known] : undefined));
      setAdded(`Added passcode ${code}.`);
      setQuery("");
      setPicked(null);
      setOpen(false);
      return;
    }
    if (pending) return;
    if (search?.error) onError(search.error);
    else if (cards.length === 0) onError(`No card found for "${trimmed}". Try another name or a passcode.`);
    else onError("None of these cards can be added to this room.");
  }

  function move(step: 1 | -1) {
    if (blocks.every((block) => block !== null)) return;
    let next = active < 0 && step === 1 ? -1 : Math.max(active, 0);
    for (let i = 0; i < blocks.length; i++) {
      next = (next + step + blocks.length) % blocks.length;
      if (blocks[next] === null) break;
    }
    setPicked(next);
  }

  const status = added || (showList ? `${cards.length} ${cards.length === 1 ? "card" : "cards"} found.` : "");

  return (
    <div className={styles.addRow}>
      <div className={styles.addCard}>
        <label htmlFor={inputId} className={ui.label}>Add card</label>
        <input
          ref={inputRef}
          id={inputId}
          value={query}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          placeholder="Card name or passcode"
          className={cx(ui.input, styles.compactInput)}
          onChange={(event) => {
            setQuery(event.target.value);
            setPicked(null);
            setAdded("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) setOpen(true);
              else move(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape" && showPanel) {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {showPanel ? (
          <div className={styles.addPanel}>
            {showList ? (
              <ul id={listId} role="listbox" aria-label="Matching cards" className={styles.addList}>
                {cards.map((card, index) => {
                  const block = blocks[index];
                  return (
                    <li
                      key={card.code}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      aria-disabled={block ? true : undefined}
                      className={styles.addOption}
                      data-active={index === active ? "true" : undefined}
                      data-blocked={block ? "true" : undefined}
                      // Keep focus in the field so the list stays open until the click lands.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => { if (!block && picked !== index) setPicked(index); }}
                      onClick={() => { if (!block) addCard(card); }}
                    >
                      <img src={cardArtUrl(card.code, "small")} alt="" loading="lazy" />
                      <span className={styles.addText}>
                        <strong>{card.name}</strong>
                        <span>{cardKindText(card) || "Card"}</span>
                      </span>
                      {block ? <span className={styles.addReason}>{block}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : search?.error ? (
              <p className={styles.addNote}>{search.error}</p>
            ) : pending ? (
              <p className={styles.addNote}>Searching…</p>
            ) : (
              <p className={styles.addNote}>{isPasscode ? "No card has this passcode. Add copies it as typed." : "No cards match."}</p>
            )}
          </div>
        ) : null}
        <span className={ui.srOnly} aria-live="polite">{status}</span>
      </div>
      <SheetSelect
        className={styles.addSection}
        label="Section"
        compact
        value={chosenSection === "side" && !sideAllowed ? "main" : chosenSection}
        choices={[
          { value: "main", label: "Main" },
          { value: "extra", label: "Extra" },
          ...(sideAllowed ? [{ value: "side" as const, label: "Side" }] : []),
        ]}
        onChange={setSection}
      />
      <SheetButton size="sm" className={styles.addBtn} onClick={submit}>
        <Plus size={15} strokeWidth={1.7} aria-hidden />Add
      </SheetButton>
    </div>
  );
}
