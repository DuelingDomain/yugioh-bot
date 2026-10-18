"use client";

import type { CardEra } from "@yugidraft/shared/cards/effects";
import { cardImageUrl } from "@/lib/card-image-url";
import * as React from "react";
import { Check, Plus, TriangleAlert } from "lucide-react";
import { AutoImportBox, ImportEntries, type ImportEntryView, type NothingFound } from "@/components/card-list-import/auto-import-box";
import { BatchBar, DEFAULT_BATCH_COPIES } from "@/components/effect-search/batch-bar";
import { DescribePane } from "@/components/effect-search/describe-pane";
import type { BatchEntry, SeedPreview } from "@/components/effect-search/effect-api";
import { PhraseSeed, type SeedOutcome } from "@/components/effect-search/phrase-seed";
import { EMPTY_BATCH, type Batch } from "@/components/effect-search/selection";
import type { ListCorrection } from "@/lib/card-list-import";
import type { CardSummary } from "@/lib/card-types";
import { putCards } from "@/lib/cards-cache";
import { isExtraDeckCardClient } from "@/lib/cube-pools";
import { useResultNav } from "@/lib/hooks/use-result-nav";
import type { AddTab } from "./library-model";
import styles from "./cubes.module.css";

export interface AddNote {
  tone: "ok" | "warn";
  text: React.ReactNode;
  /** Shown under the line: corrected names and skipped lines of a list import. */
  detail?: React.ReactNode;
}

export interface ImportOutcome {
  added?: number;
  /** Passcodes the card list lacks. A list import also reports names and section titles, as text. */
  unknown?: Array<number | string>;
  /** YDK and list import: copies the cube gained. */
  copies?: number;
  /** List import: names matched to the closest card. */
  corrected?: ListCorrection[];
  /** Batch add: passcodes the cube already held. They were skipped. */
  duplicates?: number[];
  /** The server ran out of lookups before the end of the list. */
  lookupLimited?: true;
  /** Saved-cube list import: main cards listed under Extra that went to Main. */
  movedToMain?: number;
  messages?: string[];
}

/** What the rail needs for effect search. Absent when the feature is off: the rail then looks and works as it did. */
export interface EffectRailTools {
  /** Adds the picked cards in one request. Throws an Error with a message fit to show. */
  onAddBatch: (entries: BatchEntry[]) => Promise<SeedOutcome & { duplicates: number }>;
  previewSeed: (phrase: string, options: { targetCount: number; signal: AbortSignal }) => Promise<SeedPreview>;
  confirmSeed: (entries: BatchEntry[], phrase: string) => Promise<SeedOutcome>;
  /** The release years of the cube's cards. Describe leans toward them. Absent when the cube has none to read. */
  era?: CardEra;
  /** The health note about cards much newer than the rest of the cube, when there is one. */
  eraWarning?: string;
}

export interface AddRailProps {
  initialTab?: AddTab;
  effects?: EffectRailTools;
  busy: boolean;
  /** Copies of this card already in the cube, 0 when it is not in it. */
  copiesInCube: (id: number) => number;
  onAddCard: (card: CardSummary) => void;
  /** Resolves null when the server refused (the editor shows the error). */
  onSeedArchetype: (archetype: string) => Promise<ImportOutcome | null>;
  /** What each text import added, newest last. Each can be taken out again. */
  imports: CubeImportEntry[];
  /** Adds a list, a passcode list or a YDK text. Throws a `ListImportError` (or Error) with a message when it is refused. */
  onImport: (kind: ImportKind, text: string, fileName: string | null) => Promise<void | NothingFound>;
  /** Takes out exactly the copies one import added. Throws with a message when it could not. */
  onRemoveImport: (key: number | string) => Promise<void>;
}

export type ImportKind = "list" | "passcodes" | "ydk";

/** Each entry the editor can take out again: a text import, a batch from the search, or a seeded phrase. */
export interface CubeImportEntry extends ImportEntryView {
  kind: ImportKind | "batch" | "phrase";
}

const TABS: Array<{ value: AddTab; label: string }> = [
  { value: "card", label: "Card" },
  { value: "archetype", label: "Archetype" },
  { value: "list", label: "Card list" },
  { value: "passcodes", label: "Passcodes" },
  { value: "ydk", label: "YDK" },
];

function Note({ note }: { note: AddNote | null }) {
  if (!note) return null;
  const Icon = note.tone === "ok" ? Check : TriangleAlert;
  return (
    <>
      <p className={`ce-note ${note.tone === "warn" ? "warn" : ""}`} role="status">
        <Icon className="ic" aria-hidden="true" />
        <span>{note.text}</span>
      </p>
      {note.detail}
    </>
  );
}

type CardMode = "name" | "describe";

function CardTab({ copiesInCube, onAddCard, busy, effects }: Pick<AddRailProps, "copiesInCube" | "onAddCard" | "busy" | "effects">) {
  const inputId = React.useId();
  const [mode, setMode] = React.useState<CardMode>("name");
  // The batch lives here, so it stays while the player switches between the two ways to search.
  const [batch, setBatch] = React.useState<Batch>(EMPTY_BATCH);
  const [copies, setCopies] = React.useState<number>(DEFAULT_BATCH_COPIES);
  const [adding, setAdding] = React.useState(false);
  const [batchNote, setBatchNote] = React.useState<string | null>(null);
  const heldOf = React.useCallback((card: CardSummary) => copiesInCube(card.id), [copiesInCube]);
  const kindLine = React.useCallback((card: CardSummary) => `${card.type}, ${isExtraDeckCardClient(card) ? "Extra" : "Main"}`, []);

  const addBatch = async () => {
    if (!effects || batch.cards.size === 0 || adding) return;
    setAdding(true);
    setBatchNote(null);
    try {
      const outcome = await effects.onAddBatch([...batch.cards.values()].map((card) => ({ id: card.id, copies })));
      setBatch(EMPTY_BATCH);
      const skipped = outcome.duplicates > 0 ? ` ${outcome.duplicates} already in the cube.` : "";
      setBatchNote(`Added ${outcome.added} card${outcome.added === 1 ? "" : "s"} (${outcome.copies} cop${outcome.copies === 1 ? "y" : "ies"}).${skipped}`);
    } catch (error) {
      setBatchNote(error instanceof Error && error.message ? error.message : "Could not add the cards. Try again.");
    } finally {
      setAdding(false);
    }
  };

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CardSummary[]>([]);
  const [resultsFor, setResultsFor] = React.useState("");
  // The text whose search failed. It shows only while the input still holds that text.
  const [failedFor, setFailedFor] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [searching, setSearching] = React.useState(false);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setResultsFor("");
      setFailedFor("");
      setSearching(false);
      return;
    }
    const myReq = ++reqId.current;
    const timeout = setTimeout(() => {
      setSearching(true);
      setFailedFor("");
      fetch("/api/cards/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuzzyName: q, includeExtra: true }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("search failed"))))
        .then((data: { cards: CardSummary[] }) => {
          if (myReq !== reqId.current) return;
          putCards(data.cards);
          setResults(data.cards.slice(0, 8));
          setResultsFor(q);
        })
        .catch(() => {
          if (myReq !== reqId.current) return;
          // A failed search is not "no match": say so.
          setResults([]);
          setFailedFor(q);
        })
        .finally(() => {
          if (myReq === reqId.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, retry]);

  const trimmed = query.trim();
  const failed = failedFor === trimmed && !searching;
  const nav = useResultNav({
    items: results,
    query,
    resultsFor,
    setQuery,
    onPick: onAddCard,
    canPick: (card) => !busy && copiesInCube(card.id) === 0,
  });
  const nameBody = (
    <>
      <div>
        <label className="label" htmlFor={inputId}>
          Card name
        </label>
        <input
          id={inputId}
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="blue eyes, dark magician, ..."
          autoComplete="off"
          {...nav.inputProps}
        />
        <p className="hint">
          Type a name, press Enter or pick a card. Adds 3 copies. Extra deck monsters go to the Extra pool. Select a card in the cube to change its copies.
        </p>
      </div>
      {trimmed.length > 0 && results.length > 0 && (
        <ul className="ce-res" aria-label={`Results for ${trimmed}`} aria-busy={searching || nav.stale || undefined} data-stale={nav.stale ? "" : undefined} {...nav.listProps}>
          {results.map((card, index) => {
            const copies = copiesInCube(card.id);
            const pool = isExtraDeckCardClient(card) ? "Extra" : "Main";
            return (
              <li key={card.id} data-testid="card-search-result" {...nav.optionProps(index)}>
                <span className={styles.resThumb}>
                  <img src={cardImageUrl(card.id, "small")} alt="" loading="lazy" />
                </span>
                <div className={styles.resText}>
                  <p className="n">{card.name}</p>
                  <p className="k">
                    {card.type}, {pool}
                  </p>
                </div>
                {copies > 0 ? (
                  <span className="in">
                    <Check className="ic" aria-hidden="true" />×{copies} in cube
                  </span>
                ) : (
                  // Only a look: the whole row is the option and the click target.
                  <span className="btn btn-secondary btn-sm" aria-hidden="true" data-disabled={busy ? "" : undefined}>
                    <Plus className="ic sm" />
                    Add
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {failed && (
        <div className={styles.noMatch} role="alert">
          <p style={{ margin: "0 0 8px" }}>The card search did not work.</p>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => {
            setFailedFor("");
            setRetry((n) => n + 1);
          }}>
            Try again
          </button>
        </div>
      )}
      {trimmed.length > 0 && results.length === 0 && !failed && (
        <p className={styles.noMatch} role="status">
          {searching || resultsFor !== trimmed ? "Searching..." : "No cards match."}
        </p>
      )}
    </>
  );
  // Without effect search the tab is the name search alone, as it always was.
  if (!effects) return nameBody;
  return (
    <>
      <div className="seg" role="group" aria-label="Find cards by" data-testid="card-mode">
        <button type="button" aria-pressed={mode === "name"} onClick={() => setMode("name")}>
          Name
        </button>
        <button type="button" aria-pressed={mode === "describe"} onClick={() => setMode("describe")} data-testid="mode-describe">
          Describe
        </button>
      </div>
      <div hidden={mode !== "name"}>{nameBody}</div>
      <div hidden={mode !== "describe"}>
        <DescribePane active={mode === "describe"} batch={batch} onBatch={(update) => setBatch(update)} held={heldOf} kindLine={kindLine} busy={busy || adding} era={effects.era} eraWarning={effects.eraWarning} />
      </div>
      <BatchBar
        batch={batch}
        target="cube"
        copies={copies}
        onCopies={setCopies}
        busy={busy || adding}
        note={batchNote}
        onClear={() => {
          setBatch(EMPTY_BATCH);
          setBatchNote(null);
        }}
        onAdd={() => void addBatch()}
      />
    </>
  );
}

function ArchetypeTab({
  busy,
  onSeedArchetype,
  effects,
}: Pick<AddRailProps, "busy" | "onSeedArchetype" | "effects">) {
  const inputId = React.useId();
  const listId = React.useId();
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [active, setActive] = React.useState(-1);
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState<AddNote | null>(null);
  const reqId = React.useRef(0);

  // Archetype type-ahead suggestions (graceful when the API can't be reached).
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const myReq = ++reqId.current;
    const t = setTimeout(() => {
      fetch(`/api/archetypes?query=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : { archetypes: [] }))
        .then((data: { archetypes: string[] }) => {
          if (myReq === reqId.current) setSuggestions((data.archetypes ?? []).slice(0, 8));
        })
        .catch(() => {
          if (myReq === reqId.current) setSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const seed = async (name: string) => {
    const archetype = name.trim();
    if (!archetype) return;
    setNote(null);
    setOpen(false);
    const result = await onSeedArchetype(archetype);
    if (result) {
      setQuery("");
      setSuggestions([]);
      setActive(-1);
      setNote({
        tone: "ok",
        text:
          typeof result.added === "number"
            ? `Added ${result.added} ${archetype} card${result.added === 1 ? "" : "s"} at 3 copies each.`
            : `Added all "${archetype}" cards.`,
      });
    }
  };

  const showList = open && suggestions.length > 0;
  const trimmed = query.trim();
  return (
    <>
      <div className={styles.sugWrap}>
        <label className="label" htmlFor={inputId}>
          Archetype
        </label>
        <input
          id={inputId}
          className="input"
          value={query}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Blue-Eyes, Dark Magician, ..."
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActive((i) => (i + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              void seed(showList && active >= 0 ? suggestions[active]! : query);
            } else if (event.key === "Escape" && showList) {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <div className={`ce-sug`} id={listId} role="listbox" hidden={!showList} style={{ marginTop: 6 }}>
          {suggestions.map((name, i) => (
            <button
              key={name}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              data-focus={i === active ? "" : undefined}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void seed(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="hint">Cards already in the cube keep their copy counts.</p>
      </div>
      <button
        className="btn btn-primary"
        type="button"
        disabled={busy || trimmed.length === 0}
        onClick={() => void seed(query)}
      >
        <Plus className="ic sm" aria-hidden="true" />
        {trimmed ? `Add all ${trimmed} cards` : "Add all cards"}
      </button>
      <Note note={note} />
      {effects && (
        <>
          <hr className={styles.railRule} />
          <PhraseSeed preview={effects.previewSeed} confirm={effects.confirmSeed} busy={busy} eraWarning={effects.eraWarning} />
        </>
      )}
    </>
  );
}

const AREA_STYLE: React.CSSProperties = {
  height: "auto",
  padding: "10px 12px",
  fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  fontSize: 13,
};

/** The three tabs that take text share one box: it adds a paste or a file at once and lists what it added. */
function ImportTab({
  kind,
  label,
  placeholder,
  hint,
  fileLabel,
  busy,
  imports,
  onImport,
  onRemoveImport,
}: Pick<AddRailProps, "busy" | "imports" | "onImport" | "onRemoveImport"> & {
  kind: ImportKind;
  label: string;
  placeholder: string;
  hint: React.ReactNode;
  fileLabel?: string;
}) {
  const entries = React.useMemo(() => imports.filter((entry) => entry.kind === kind), [imports, kind]);
  return (
    <AutoImportBox
      label={label}
      placeholder={placeholder}
      hint={hint}
      fileLabel={fileLabel}
      disabled={busy}
      run={(text, fileName) => onImport(kind, text, fileName)}
      entries={entries}
      onRemove={onRemoveImport}
      textareaStyle={AREA_STYLE}
      fileButtonClassName="btn btn-quiet btn-sm"
      fileInputClassName={styles.fileInput}
    />
  );
}

/** The "Add cards" rail body: one segmented control, five ways to add. */
export function AddCardsBody(props: AddRailProps) {
  const [tab, setTab] = React.useState<AddTab>(props.initialTab ?? "card");
  // Search and phrase imports can be removed in the same way as text imports.
  const searchEntries = React.useMemo(() => props.imports.filter((entry) => entry.kind === "batch" || entry.kind === "phrase"), [props.imports]);
  return (
    <>
      <div className="seg" role="group" aria-label="Add by" style={{ width: "100%" }}>
        {TABS.map((t) => (
          <button key={t.value} type="button" aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab === "card" && <CardTab busy={props.busy} copiesInCube={props.copiesInCube} onAddCard={props.onAddCard} effects={props.effects} />}
        {tab === "archetype" && <ArchetypeTab busy={props.busy} onSeedArchetype={props.onSeedArchetype} effects={props.effects} />}
        {tab === "list" && (
          <ImportTab
            {...props}
            kind="list"
            label="Card list"
            placeholder={"3 Dark Hole\nShooting Star Dragon\n46986414\n\nOr paste a whole .ydk file"}
            hint={
              <>
                Card names or passcodes, one per line. A number before a name is its copies, like 3 Dark Hole. Without one, a card
                gets 1 copy. A paste or a loaded file is added at once and copies add to the ones already in the cube. Extra Deck
                monsters go to the Extra pool. Typed text is added when you press Enter or choose Add. Shift+Enter starts a new line.
              </>
            }
          />
        )}
        {tab === "passcodes" && (
          <ImportTab
            {...props}
            kind="passcodes"
            label="Passcodes, one per line"
            placeholder={"46986414\n83764718, 12345678"}
            fileLabel="Load a .txt file"
            hint={
              <>
                List a card as many times as you want copies, up to 99. A card already in the cube takes the new count, so one line
                sets it to ×1. A paste or a loaded file is added at once. Typed text is added when you press Enter or choose Add. Shift+Enter starts a new line.
              </>
            }
          />
        )}
        {tab === "ydk" && (
          <ImportTab
            {...props}
            kind="ydk"
            label="Deck list (.ydk)"
            placeholder={"#main\n46986414\n46986414\n#extra\n23995346\n!side"}
            fileLabel="Load a .ydk file"
            hint={
              <>
                Each line is one copy, up to 99. Copies add to the ones already in the cube. Extra Deck monsters and the #extra
                section go to the Extra pool; main and side cards go to Main. A paste or a loaded file is added at once.
              </>
            }
          />
        )}
        {props.effects && (tab === "card" || tab === "archetype") && searchEntries.length > 0 && (
          <ImportEntries entries={searchEntries} onRemove={props.onRemoveImport} />
        )}
      </div>
    </>
  );
}
