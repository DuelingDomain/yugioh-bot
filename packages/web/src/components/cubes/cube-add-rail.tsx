"use client";

import * as React from "react";
import { Check, Plus, TriangleAlert, Upload } from "lucide-react";
import type { CardSummary } from "@/lib/card-types";
import { putCards } from "@/lib/cards-cache";
import { parseCustomCardIds } from "@/lib/custom-card-pool";
import { isExtraDeckCardClient } from "@/lib/cube-pools";
import { useResultNav } from "@/lib/hooks/use-result-nav";
import type { AddTab } from "./library-model";
import styles from "./cubes.module.css";

export interface AddNote {
  tone: "ok" | "warn";
  text: React.ReactNode;
}

export interface ImportOutcome {
  added?: number;
  unknown?: number[];
  /** YDK import: copies the cube gained. */
  copies?: number;
}

export interface AddRailProps {
  initialTab?: AddTab;
  busy: boolean;
  /** Copies of this card already in the cube, 0 when it is not in it. */
  copiesInCube: (id: number) => number;
  onAddCard: (card: CardSummary) => void;
  /** Resolves null when the server refused (the editor shows the error). */
  onSeedArchetype: (archetype: string) => Promise<ImportOutcome | null>;
  onImportCodes: (codes: number[]) => Promise<ImportOutcome | null>;
  onImportYdk: (text: string) => Promise<ImportOutcome | null>;
}

const TABS: Array<{ value: AddTab; label: string }> = [
  { value: "card", label: "Card" },
  { value: "archetype", label: "Archetype" },
  { value: "passcodes", label: "Passcodes" },
  { value: "ydk", label: "YDK" },
];

function Note({ note }: { note: AddNote | null }) {
  if (!note) return null;
  const Icon = note.tone === "ok" ? Check : TriangleAlert;
  return (
    <p className={`ce-note ${note.tone === "warn" ? "warn" : ""}`} role="status">
      <Icon className="ic" aria-hidden="true" />
      <span>{note.text}</span>
    </p>
  );
}

function CardTab({ copiesInCube, onAddCard, busy }: Pick<AddRailProps, "copiesInCube" | "onAddCard" | "busy">) {
  const inputId = React.useId();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CardSummary[]>([]);
  const [resultsFor, setResultsFor] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setResultsFor("");
      setSearching(false);
      return;
    }
    const myReq = ++reqId.current;
    const timeout = setTimeout(() => {
      setSearching(true);
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
          setResults([]);
          setResultsFor(q);
        })
        .finally(() => {
          if (myReq === reqId.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const trimmed = query.trim();
  const nav = useResultNav({
    items: results,
    query,
    resultsFor,
    setQuery,
    onPick: onAddCard,
    canPick: (card) => !busy && copiesInCube(card.id) === 0,
  });
  return (
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
                  <img src={card.imageUrlSmall || card.imageUrl} alt="" loading="lazy" />
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
      {trimmed.length > 0 && results.length === 0 && (
        <p className={styles.noMatch} role="status">
          {searching || resultsFor !== trimmed ? "Searching..." : "No cards match."}
        </p>
      )}
    </>
  );
}

function ArchetypeTab({
  busy,
  onSeedArchetype,
}: Pick<AddRailProps, "busy" | "onSeedArchetype">) {
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
    </>
  );
}

function PasscodesTab({ busy, onImportCodes }: Pick<AddRailProps, "busy" | "onImportCodes">) {
  const areaId = React.useId();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState("");
  const [note, setNote] = React.useState<AddNote | null>(null);

  const readFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const submit = async () => {
    setNote(null);
    const parsed = parseCustomCardIds(text);
    if (parsed.errors.length > 0) {
      setNote({ tone: "warn", text: `Remove invalid passcodes: ${parsed.errors.slice(0, 3).join(", ")}` });
      return;
    }
    if (parsed.cardIds.length === 0) {
      setNote({ tone: "warn", text: "Paste at least one passcode to import." });
      return;
    }
    const result = await onImportCodes(parsed.cardIds);
    if (!result) return;
    setText("");
    const unknown = result.unknown ?? [];
    const added = result.added;
    const head =
      typeof added === "number"
        ? `Added ${added} card${added === 1 ? "" : "s"}.`
        : `Imported ${parsed.cardIds.length} passcode${parsed.cardIds.length === 1 ? "" : "s"}.`;
    if (unknown.length > 0) {
      setNote({
        tone: "warn",
        text: (
          <>
            {head} Not found: <code>{unknown.slice(0, 5).join(", ")}</code>
            {unknown.length > 5 ? ` and ${unknown.length - 5} more` : ""}. Check the passcode and try it again.
          </>
        ),
      });
    } else {
      setNote({ tone: "ok", text: head });
    }
  };

  return (
    <>
      <div>
        <label className="label" htmlFor={areaId}>
          Passcodes, one per line
        </label>
        <textarea
          id={areaId}
          className="input"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"46986414\n83764718, 12345678"}
          style={{ height: "auto", padding: "10px 12px", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13 }}
        />
        <p className="hint">
          List a card as many times as you want copies, up to 99. A card already in the cube takes the new count, so one line
          sets it to ×1.
        </p>
      </div>
      <div className="ce-file">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          className={styles.fileInput}
          aria-label="Upload text file"
          tabIndex={-1}
          onChange={(event) => {
            readFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => fileRef.current?.click()}>
          <Upload className="ic sm" aria-hidden="true" />
          Load a .txt file
        </button>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void submit()}>
          Add passcodes
        </button>
      </div>
      <Note note={note} />
    </>
  );
}

function YdkTab({ busy, onImportYdk }: Pick<AddRailProps, "busy" | "onImportYdk">) {
  const areaId = React.useId();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState("");
  const [note, setNote] = React.useState<AddNote | null>(null);

  const readFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const submit = async () => {
    setNote(null);
    if (text.trim() === "") {
      setNote({ tone: "warn", text: "Load a .ydk file or paste a deck list first." });
      return;
    }
    const result = await onImportYdk(text);
    if (!result) return;
    setText("");
    const added = result.added ?? 0;
    const copies = result.copies ?? 0;
    const unknown = result.unknown ?? [];
    const head = `Added ${added} card${added === 1 ? "" : "s"}, ${copies} cop${copies === 1 ? "y" : "ies"}.`;
    if (unknown.length > 0) {
      setNote({
        tone: "warn",
        text: (
          <>
            {head} Not found: <code>{unknown.slice(0, 5).join(", ")}</code>
            {unknown.length > 5 ? ` and ${unknown.length - 5} more` : ""}.
          </>
        ),
      });
    } else {
      setNote({ tone: "ok", text: head });
    }
  };

  return (
    <>
      <div>
        <label className="label" htmlFor={areaId}>
          Deck list (.ydk)
        </label>
        <textarea
          id={areaId}
          className="input"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"#main\n46986414\n46986414\n#extra\n23995346\n!side"}
          style={{ height: "auto", padding: "10px 12px", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13 }}
        />
        <p className="hint">
          Each line is one copy, up to 99. Copies add to the ones already in the cube. Extra Deck monsters and the #extra
          section go to the Extra pool; main and side cards go to Main.
        </p>
      </div>
      <div className="ce-file">
        <input
          ref={fileRef}
          type="file"
          accept=".ydk,.txt,text/plain"
          className={styles.fileInput}
          aria-label="Upload YDK file"
          tabIndex={-1}
          onChange={(event) => {
            readFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => fileRef.current?.click()}>
          <Upload className="ic sm" aria-hidden="true" />
          Load a .ydk file
        </button>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void submit()}>
          Add deck list
        </button>
      </div>
      <Note note={note} />
    </>
  );
}

/** The "Add cards" rail body: one segmented control, four ways to add. */
export function AddCardsBody(props: AddRailProps) {
  const [tab, setTab] = React.useState<AddTab>(props.initialTab ?? "card");
  return (
    <>
      <div className="seg" role="group" aria-label="Add by" style={{ width: "100%" }}>
        {TABS.map((t) => (
          <button key={t.value} type="button" aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "card" && <CardTab busy={props.busy} copiesInCube={props.copiesInCube} onAddCard={props.onAddCard} />}
      {tab === "archetype" && <ArchetypeTab busy={props.busy} onSeedArchetype={props.onSeedArchetype} />}
      {tab === "passcodes" && <PasscodesTab busy={props.busy} onImportCodes={props.onImportCodes} />}
      {tab === "ydk" && <YdkTab busy={props.busy} onImportYdk={props.onImportYdk} />}
    </>
  );
}
