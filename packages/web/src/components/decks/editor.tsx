"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  cardLimit,
  emptyCardQuery,
  type CardArchetype,
  type CardFacets,
  type CardQuery,
  type DeckCardInfo,
  type DuelDeck,
  type DuelMode,
  type SavedDeck,
} from "@yugidraft/shared/duels";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  Crown,
  Download,
  Hand,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { TYPE_MONSTER } from "@/components/duel/constants";
import { CardInspector } from "@/components/duel/inspector";
import { parseDeckText, selectDomainMaster, type DeckMasterSelection } from "@/components/duel/ydk";
import { cx, SheetButton, SheetSegmented, SheetSelect, sheetButtonClass, sheetRoot } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { useNavigationLeaveGuard } from "@/lib/hooks/use-duel-leave-guard";
import { createSavedDeck, deleteSavedDeck, getDeckCardFacets, getDeckCards, getSavedDeck, updateSavedDeck } from "./api";
import { CardActions } from "./card-actions";
import { CardArt } from "./card-art";
import { CardBrowser } from "./card-browser";
import { hasCardDrag, readCardDrag, writeCardDrag } from "./drag";
import {
  BANLIST_CHOICES,
  banlistLabel,
  loadEditorPrefs,
  saveEditorPrefs,
  type BrowserView,
} from "./filter-model";
import { deckNameFromFile, MAX_IMPORT_FILE_BYTES } from "./import";
import { DeckImportPopover, Popover } from "./import-popover";
import {
  DEFAULT_NAME,
  EMPTY_DECK,
  MAX_NAME_LENGTH,
  allCodes,
  chooseMaster,
  clearSection,
  cloneDeck,
  copyCounts,
  copyLimit,
  copyProblems,
  defaultAddSection,
  downloadYdkFile,
  guidanceNotes,
  importForLibrary,
  isNewDeckDirty,
  placeCard,
  removeCard,
  shuffled,
  snapshotOf,
  sortDeck,
  uniqueCodes,
  type CardSource,
  type DeckSection,
  type SelectedStack,
} from "./model";
import { DeckSectionGrid, type CountTone } from "./section-grid";
import styles from "./editor.module.css";

const MODE_CHOICES = [
  { value: "normal" as const, label: "Standard" },
  { value: "domain" as const, label: "Domain" },
] as const;

const HISTORY_LIMIT = 100;
const HAND_SIZE = 5;

/** One undo step. The format is part of it, because a format change can move the Deck Master. */
type Snapshot = { selection: DeckMasterSelection; mode: DuelMode };
type History = { past: Snapshot[]; future: Snapshot[] };
type TestHand = { drawn: number[]; pile: number[] };

function parseRouteId(raw: string | undefined): number | "new" | "invalid" {
  if (raw == null || raw === "") return "new";
  if (!/^\d+$/.test(raw)) return "invalid";
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return "invalid";
  return id;
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function copiesText(max: number): string {
  if (max === 0) return "is Forbidden";
  return `allows ${max} ${max === 1 ? "copy" : "copies"}`;
}

function mainTone(mode: DuelMode, count: number): CountTone {
  if (mode === "domain") return count === 60 ? "ok" : count > 60 ? "bad" : "warn";
  return count >= 40 && count <= 60 ? "ok" : count > 60 ? "bad" : "warn";
}

export function SavedDeckEditor({ deckId }: { deckId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const routeId = parseRouteId(deckId ?? (/^\/decks\/(\d+)$/.exec(pathname)?.[1]));

  const [savedId, setSavedId] = useState<number | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [mode, setMode] = useState<DuelMode>("normal");
  const [selection, setSelection] = useState<DeckMasterSelection>({ deck: EMPTY_DECK, masterOrigin: null });
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [baseline, setBaseline] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(routeId === "invalid" ? "That deck id is not valid." : null);
  const [loading, setLoading] = useState(typeof routeId === "number");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Map<number, DeckCardInfo>>(() => new Map());
  const [unknown, setUnknown] = useState<Set<number>>(() => new Set());
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaRetry, setMetaRetry] = useState(0);
  const [selected, setSelected] = useState<SelectedStack | null>(null);
  const [inspectCode, setInspectCode] = useState<number | null>(null);
  const [query, setQuery] = useState<CardQuery>(() => emptyCardQuery());
  const [view, setView] = useState<BrowserView>("grid");
  const [prefsReady, setPrefsReady] = useState(false);
  const [facets, setFacets] = useState<CardFacets | null>(null);
  const [facetsError, setFacetsError] = useState(false);
  const [facetsRetry, setFacetsRetry] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [hand, setHand] = useState<TestHand | null>(null);
  const [masterDropping, setMasterDropping] = useState(false);
  const importGeneration = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { importGeneration.current += 1; }, []);

  const { deck, masterOrigin } = selection;
  const busy = saveBusy || deleteBusy;
  const dirty = baseline == null ? isNewDeckDirty(name, mode, deck) : snapshotOf(name.trim(), mode, deck) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useNavigationLeaveGuard(dirty, "You have unsaved deck changes. Leave without saving?");

  // Preferences are read after mount, so the server render and the first client render agree.
  useEffect(() => {
    const prefs = loadEditorPrefs();
    setQuery((current) => ({
      ...current,
      sort: prefs.sort ?? current.sort,
      order: prefs.order ?? current.order,
      banlist: prefs.banlist ?? current.banlist,
      scope: prefs.scope ?? current.scope,
    }));
    if (prefs.view) setView(prefs.view);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    saveEditorPrefs({ sort: query.sort, order: query.order, view, banlist: query.banlist, scope: query.scope });
  }, [prefsReady, query.sort, query.order, query.banlist, query.scope, view]);

  useEffect(() => {
    let cancelled = false;
    setFacetsError(false);
    void getDeckCardFacets().then(
      (result) => { if (!cancelled) setFacets(result); },
      () => { if (!cancelled) setFacetsError(true); },
    );
    return () => { cancelled = true; };
  }, [facetsRetry]);

  // A deck file dropped outside the import box must not make the browser leave the editor.
  useEffect(() => {
    function stopFileDrop(event: DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    }
    window.addEventListener("dragover", stopFileDrop);
    window.addEventListener("drop", stopFileDrop);
    return () => {
      window.removeEventListener("dragover", stopFileDrop);
      window.removeEventListener("drop", stopFileDrop);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (routeId === "invalid" || routeId === "new" || routeId === savedId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getSavedDeck(routeId).then(
      (record) => {
        if (cancelled) return;
        setLoading(false);
        if (dirtyRef.current) return;
        applyRecord(record);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setLoadError(reason instanceof Error ? reason.message : "Could not load this deck.");
      },
    );
    return () => { cancelled = true; };
  }, [routeId]);

  useEffect(() => {
    const needed = uniqueCodes(allCodes(deck)).filter((code) => !catalog.has(code) && !unknown.has(code) && !blocked.has(code));
    if (needed.length === 0) return;
    let cancelled = false;
    setMetaError(null);
    void getDeckCards(needed).then(
      ({ cards, missing }) => {
        if (cancelled) return;
        rememberCatalog(cards);
        setUnknown((prev) => {
          const next = new Set(prev);
          for (const code of missing) next.add(code);
          return next;
        });
      },
      (reason: unknown) => {
        if (cancelled) return;
        setBlocked((prev) => {
          const next = new Set(prev);
          for (const code of needed) next.add(code);
          return next;
        });
        setMetaError(reason instanceof Error ? reason.message : "Could not load card details.");
      },
    );
    return () => { cancelled = true; };
  }, [deck, metaRetry]);

  // A test hand shows one draw of the current Main Deck; a changed deck needs a new draw.
  const mainKey = deck.main.join(",");
  useEffect(() => { setHand(null); }, [mainKey]);

  const rememberCatalog = useCallback((cards: DeckCardInfo[]) => {
    if (cards.length === 0) return;
    setCatalog((prev) => {
      if (cards.every((card) => prev.get(card.code) === card)) return prev;
      const next = new Map(prev);
      for (const card of cards) next.set(card.code, card);
      return next;
    });
  }, []);

  function applyRecord(record: SavedDeck) {
    setSavedId(record.id);
    setName(record.name);
    setMode(record.mode);
    setSelection({ deck: cloneDeck(record.deck), masterOrigin: null });
    setHistory({ past: [], future: [] });
    setParseError(null);
    setBaseline(snapshotOf(record.name, record.mode, record.deck));
  }

  function commit(next: DeckMasterSelection, nextMode: DuelMode = mode) {
    if (busy || (next === selection && nextMode === mode)) return;
    importGeneration.current += 1;
    setHistory((current) => ({ past: [...current.past.slice(-(HISTORY_LIMIT - 1)), { selection, mode }], future: [] }));
    setSelection(next);
    setMode(nextMode);
    setParseError(null);
    setSavedFlash(false);
  }

  function restore(step: Snapshot) {
    importGeneration.current += 1;
    setSelection(step.selection);
    setMode(step.mode);
    setSavedFlash(false);
  }

  function undo() {
    const previous = history.past.at(-1);
    if (busy || !previous) return;
    setHistory({ past: history.past.slice(0, -1), future: [{ selection, mode }, ...history.future] });
    restore(previous);
  }

  function redo() {
    const next = history.future[0];
    if (busy || !next) return;
    setHistory({ past: [...history.past, { selection, mode }], future: history.future.slice(1) });
    restore(next);
  }

  const limits = query.banlist === "none" ? null : facets?.banlists[query.banlist] ?? null;
  const limitsPending = query.banlist !== "none" && facets == null && !facetsError;
  const banlistName = query.banlist === "none" ? null : banlistLabel(query.banlist);
  const counts = useMemo(() => copyCounts(deck, catalog), [deck, catalog]);
  const problems = useMemo(() => copyProblems(deck, catalog, limits), [deck, catalog, limits]);
  const over = useMemo(() => new Set(problems.map((problem) => problem.key)), [problems]);
  const archetypes = facets?.archetypes ?? [];

  const deckCount = useCallback(
    (card: DeckCardInfo) => counts.get(`name:${card.name}`) ?? counts.get(`code:${card.code}`) ?? 0,
    [counts],
  );

  function inspect(code: number, stack: SelectedStack | null = null) {
    setInspectCode(code);
    setSelected(stack);
  }

  /** Main and Extra only take the cards that belong there; the Side Deck takes any card. */
  function sectionFor(code: number, wanted: DeckSection): DeckSection {
    const card = catalog.get(code);
    if (!card || wanted === "side") return wanted;
    return defaultAddSection(card);
  }

  function roomFor(card: DeckCardInfo): boolean {
    if (limitsPending) {
      setNotice("Loading the banlist. Try again in a moment.");
      return false;
    }
    const max = limits ? cardLimit(limits, card) : 3;
    const have = deckCount(card);
    if (have < max) return true;
    setNotice(max === 3
      ? `${card.name}: you already have 3 copies.`
      : `${card.name}: ${banlistName ?? "the banlist"} ${copiesText(max)}.`);
    return false;
  }

  function addFromList(card: DeckCardInfo, wanted?: DeckSection) {
    rememberCatalog([card]);
    if (!roomFor(card)) return;
    const to = wanted === "side" ? "side" : defaultAddSection(card);
    commit(placeCard(selection, { code: card.code, from: "list" }, to));
  }

  function dropCard(source: CardSource, wanted: DeckSection, at?: number) {
    const to = sectionFor(source.code, wanted);
    // A card dropped on the wrong section of its own home stays where it is.
    if (to !== wanted && source.from === to) {
      setNotice(`${cardName(source.code)} goes in the ${to === "extra" ? "Extra" : "Main"} Deck.`);
      return;
    }
    if (source.from === "list") {
      const card = catalog.get(source.code);
      if (card && !roomFor(card)) return;
    }
    commit(placeCard(selection, source, to, to === wanted ? at : undefined));
    setSelected({ section: to, code: source.code });
    setInspectCode(source.code);
    if (to !== wanted) {
      setNotice(`${cardName(source.code)} goes in the ${to === "extra" ? "Extra" : "Main"} Deck.`);
    }
  }

  function removeCopy(source: CardSource) {
    const next = removeCard(selection, source);
    commit(next);
    if (source.from !== "list" && source.from !== "master" && !next.deck[source.from].includes(source.code)) {
      setSelected(null);
    }
  }

  function makeMaster(code: number, section?: DeckSection) {
    const card = catalog.get(code);
    if (card && (card.type & TYPE_MONSTER) === 0) {
      setNotice("The Deck Master must be a monster.");
      return;
    }
    // A Deck Master that is not in the deck yet is a new copy, so it must fit the copy limit.
    const inDeck = deck.main.includes(code) || deck.extra.includes(code) || deck.side.includes(code);
    if (card && !inDeck && !roomFor(card)) return;
    commit(chooseMaster(selection, code, section));
    setInspectCode(code);
    setSelected(null);
  }

  function cardName(code: number): string {
    return catalog.get(code)?.name ?? `Passcode ${code}`;
  }

  function showArchetype(archetype: CardArchetype) {
    setQuery((current) => ({ ...current, archetypes: [...archetype.codes], archetypeMode: "member", text: "" }));
    searchRef.current?.focus();
  }

  function applyImported(raw: DuelDeck) {
    if (allCodes(raw).length === 0) {
      throw new Error("No cards found. Import a YDK deck or a ydke:// link.");
    }
    const nextMode = raw.deckMaster != null ? "domain" : mode;
    commit(importForLibrary(raw, nextMode), nextMode);
    setSelected(null);
    setImportOpen(false);
    setNotice("Deck imported. Press Ctrl+Z to undo.");
  }

  function onFile(file: File) {
    if (busy) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setParseError("This file is too large to be a YDK deck.");
      return;
    }
    const generation = ++importGeneration.current;
    setFileName(file.name);
    void file.text().then(
      (text) => {
        if (generation !== importGeneration.current) return;
        try {
          applyImported(parseDeckText(text));
          // A new deck that still has the default name takes the file's name.
          if (savedId == null && name.trim() === DEFAULT_NAME) setName(deckNameFromFile(file.name));
        } catch (reason: unknown) {
          setParseError(reason instanceof Error ? reason.message : "Could not parse that deck.");
        }
      },
      (reason: unknown) => {
        if (generation === importGeneration.current) {
          setParseError(reason instanceof Error ? reason.message : "Could not read that file.");
        }
      },
    );
  }

  function onPaste(text: string) {
    importGeneration.current += 1;
    try {
      applyImported(parseDeckText(text));
    } catch (reason: unknown) {
      setParseError(reason instanceof Error ? reason.message : "Could not parse that deck.");
    }
  }

  function dealHand() {
    const pile = shuffled(deck.main);
    setHand({ drawn: pile.slice(0, HAND_SIZE), pile: pile.slice(HAND_SIZE) });
  }

  async function save() {
    // Ctrl+S also works on the loading and error screens; there is no deck to save there.
    if (busy || loading || loadError != null || routeId === "invalid" || (typeof routeId === "number" && savedId == null)) return;
    importGeneration.current += 1;
    const trimmed = name.trim();
    if (!trimmed) {
      setSaveError("Deck name is required.");
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    const body = { name: trimmed, mode, deck: cloneDeck(deck) };
    try {
      const record = savedId == null ? await createSavedDeck(body) : await updateSavedDeck(savedId, body);
      flushSync(() => {
        setName(record.name);
        setMode(record.mode);
        setSelection({ deck: cloneDeck(record.deck), masterOrigin });
        setBaseline(snapshotOf(record.name, record.mode, record.deck));
        setSavedId(record.id);
        setSavedFlash(true);
      });
      // Keep selection provenance when a new deck acquires its permanent URL.
      if (savedId == null) window.history.replaceState(null, "", `/decks/${record.id}`);
    } catch (reason: unknown) {
      setSaveError(reason instanceof Error ? reason.message : "Could not save this deck.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function confirmDelete() {
    if (savedId == null || deleteBusy) return;
    importGeneration.current += 1;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteSavedDeck(savedId);
      flushSync(() => setBaseline(snapshotOf(name.trim(), mode, deck)));
      router.push("/decks");
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : "Could not delete this deck.");
      setDeleteBusy(false);
    }
  }

  const shortcuts = useRef({ undo, redo, save });
  shortcuts.current = { undo, redo, save };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "s") {
        event.preventDefault();
        void shortcuts.current.save();
        return;
      }
      if (typingTarget(event.target)) return;
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) shortcuts.current.redo();
        else shortcuts.current.undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        shortcuts.current.redo();
      } else if (!mod && !event.altKey && event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const notes = guidanceNotes(mode, deck);
  const inspected = inspectCode == null ? undefined : catalog.get(inspectCode);
  const statusTone = saveError ? "bad" : dirty ? "warn" : savedId != null ? "ok" : undefined;
  const statusText = saveBusy
    ? "Saving…"
    : saveError
      ? saveError
      : dirty
        ? "Unsaved changes"
        : savedFlash || savedId != null
          ? "Saved"
          : "New deck";

  if (routeId === "invalid" || (loadError && savedId == null)) {
    return (
      <div className={cx(sheetRoot, styles.editor, styles.center)}>
        <p role="alert" className={ui.alert}>{loadError ?? "That deck id is not valid."}</p>
        <Link href="/decks" className={sheetButtonClass("secondary")}>Back to decks</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cx(sheetRoot, styles.editor, styles.center)}>
        <p className={ui.hint}>Loading deck…</p>
      </div>
    );
  }

  const sectionProps = {
    catalog,
    unknown,
    limits,
    over,
    selected,
    onSelect: (stack: SelectedStack) => inspect(stack.code, stack),
    onRemove: removeCopy,
    onDrop: dropCard,
  };

  const clearButton = (section: DeckSection, label: string) => (
    <SheetButton
      kind="quiet"
      size="sm"
      disabled={deck[section].length === 0 || busy}
      aria-label={`Remove every card from the ${label} Deck`}
      onClick={() => {
        commit(clearSection(selection, section));
        setNotice(`${label} Deck cleared. Press Ctrl+Z to undo.`);
      }}
    >
      <Trash2 size={14} strokeWidth={1.6} aria-hidden />
      Clear
    </SheetButton>
  );

  return (
    <div className={cx(sheetRoot, styles.editor)}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarLead}>
          <Link href="/decks" className={cx(sheetButtonClass("quiet", "sm"), styles.back)} aria-label="Back to decks">
            <ArrowLeft size={16} strokeWidth={1.6} aria-hidden />
            <span className={styles.backText}>Decks</span>
          </Link>
          <label className={styles.nameField}>
            <span className={ui.srOnly}>Deck name</span>
            <input
              className={styles.nameInput}
              value={name}
              maxLength={MAX_NAME_LENGTH}
              disabled={busy}
              onChange={(event) => { importGeneration.current += 1; setName(event.target.value); setSavedFlash(false); }}
            />
          </label>
          <SheetSegmented
            label="Format"
            hideLabel
            value={mode}
            disabled={busy}
            choices={MODE_CHOICES}
            onChange={(value) => commit(selection, value)}
          />
          <SheetSelect
            label="Banlist"
            hideLabel
            compact
            className={styles.banlist}
            value={query.banlist}
            choices={BANLIST_CHOICES}
            onChange={(banlist) => setQuery((current) => ({ ...current, banlist, limits: banlist === "none" ? [] : current.limits }))}
          />
        </div>
        <div className={styles.toolbarActions}>
          <p className={styles.status} data-tone={statusTone} aria-live="polite">{statusText}</p>
          <div className={styles.history}>
            <button type="button" className={styles.toolIcon} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={busy || history.past.length === 0} onClick={undo}>
              <Undo2 size={16} strokeWidth={1.6} aria-hidden />
            </button>
            <button type="button" className={styles.toolIcon} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={busy || history.future.length === 0} onClick={redo}>
              <Redo2 size={16} strokeWidth={1.6} aria-hidden />
            </button>
          </div>
          <DeckImportPopover
            open={importOpen}
            onOpenChange={(open) => { setImportOpen(open); if (open) setParseError(null); }}
            disabled={busy}
            mode={mode}
            fileName={fileName}
            error={parseError}
            onFile={onFile}
            onPaste={onPaste}
          />
          <SheetButton size="sm" onClick={() => downloadYdkFile(name, deck)}>
            <Download size={15} strokeWidth={1.6} aria-hidden />
            Export
          </SheetButton>
          {savedId != null ? (
            <Popover
              label="Delete"
              icon={<Trash2 size={15} strokeWidth={1.6} aria-hidden />}
              kind="quiet"
              open={deleteOpen}
              onOpenChange={(open) => { setDeleteOpen(open); setDeleteError(null); }}
              disabled={busy}
            >
              <div className={styles.confirm}>
                <p>Delete <strong>{name.trim() || "this deck"}</strong>? You cannot undo this.</p>
                {deleteError ? <p role="alert" className={ui.alert}>{deleteError}</p> : null}
                <div className={styles.popoverActions}>
                  <SheetButton kind="quiet" size="sm" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>Keep</SheetButton>
                  <SheetButton kind="danger" size="sm" loading={deleteBusy} onClick={() => void confirmDelete()}>Delete deck</SheetButton>
                </div>
              </div>
            </Popover>
          ) : null}
          <SheetButton kind="primary" size="sm" loading={saveBusy} disabled={busy} title="Save (Ctrl+S)" onClick={() => void save()}>
            <Save size={15} strokeWidth={1.6} aria-hidden />
            Save
          </SheetButton>
        </div>
      </header>

      <div className={styles.panes}>
        <aside className={styles.inspectPane} aria-label="Card details">
          <div className={styles.inspectScroll}>
            {inspectCode == null ? (
              <div className={styles.inspectEmpty}>
                <p className={styles.inspectEmptyTitle}>Select a card to see its text.</p>
                <ul className={styles.tips}>
                  <li><b>Add</b> Double-click, right-click or drag a card from the list.</li>
                  <li><b>Remove</b> Right-click a card in the deck, press Delete, or drag it back to the list.</li>
                  <li><b>Move</b> Drag a card between Main, Extra and Side.</li>
                  <li><b>Keys</b> <kbd>/</kbd> search · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save</li>
                </ul>
              </div>
            ) : inspected ? (
              <CardInspector target={{ type: "info", card: inspected }} />
            ) : (
              <p className={styles.inspectNotice}>
                Passcode {inspectCode}: {unknown.has(inspectCode)
                  ? "this card is not in the card database. It stays in your deck."
                  : metaError ? "card details are not available." : "loading card details…"}
              </p>
            )}
          </div>
          {inspected ? (
            <CardActions
              card={inspected}
              deck={deck}
              mode={mode}
              copies={deckCount(inspected)}
              limit={copyLimit(inspected.code, catalog, limits)}
              banlistName={banlistName}
              archetypes={archetypes}
              onAdd={(section) => addFromList(inspected, section)}
              onRemove={(section) => removeCopy({ code: inspected.code, from: section })}
              onMaster={() => makeMaster(inspected.code, selected?.code === inspected.code ? selected.section : undefined)}
              onArchetype={showArchetype}
            />
          ) : null}
        </aside>

        <main className={styles.deckPane} aria-label="Deck">
          <div className={styles.deckBar}>
            {notes.length > 0 || problems.length > 0 ? (
              <details className={styles.notes}>
                <summary>
                  <AlertTriangle size={15} strokeWidth={1.6} aria-hidden />
                  {problems.length > 0
                    ? `${problems.length} ${problems.length === 1 ? "card has" : "cards have"} too many copies`
                    : `${notes.length} deck ${notes.length === 1 ? "note" : "notes"}`}
                </summary>
                <ul className={ui.bannerList}>
                  {problems.map((problem) => (
                    <li key={problem.key}>
                      {problem.name}: {problem.count} copies, {problem.max === 0 ? "Forbidden" : `${problem.max} allowed`}
                      {banlistName && problem.max < 3 ? ` on ${banlistName}` : ""}.
                    </li>
                  ))}
                  {notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
                <p className={ui.hint}>You can save an unfinished deck. The table checks legality when you ready up.</p>
              </details>
            ) : (
              <p className={styles.notesOk}>Deck size is correct for {mode === "domain" ? "Domain" : "Standard"}.</p>
            )}
            <div className={styles.deckTools}>
              <SheetButton kind="quiet" size="sm" disabled={busy || allCodes(deck).length === 0} onClick={() => commit(sortDeck(selection, catalog))}>
                <ArrowDownUp size={14} strokeWidth={1.6} aria-hidden />
                Sort
              </SheetButton>
              <SheetButton kind="quiet" size="sm" disabled={deck.main.length === 0} aria-pressed={hand != null} onClick={() => (hand ? setHand(null) : dealHand())}>
                <Hand size={14} strokeWidth={1.6} aria-hidden />
                Test hand
              </SheetButton>
            </div>
          </div>

          {notice ? (
            <p className={styles.notice} role="status">
              {notice}
              <button type="button" className={styles.noticeClose} aria-label="Close message" onClick={() => setNotice(null)}>
                <X size={14} aria-hidden />
              </button>
            </p>
          ) : null}

          {facetsError ? (
            <div className={cx(ui.banner, ui.bannerBad)}>
              <AlertTriangle size={17} strokeWidth={1.6} aria-hidden />
              <div className={ui.bannerBody}>
                <strong>Filters and banlists are not available</strong>
                <p>Archetype filters do not load and the editor does not check banlist limits.</p>
                <SheetButton size="sm" onClick={() => setFacetsRetry((value) => value + 1)}>Try again</SheetButton>
              </div>
            </div>
          ) : null}

          {metaError ? (
            <div className={cx(ui.banner, ui.bannerBad)}>
              <AlertTriangle size={17} strokeWidth={1.6} aria-hidden />
              <div className={ui.bannerBody}>
                <strong>Card details are not available</strong>
                <p>{metaError} The passcodes stay in the deck.</p>
                <SheetButton size="sm" onClick={() => { setBlocked(new Set()); setMetaRetry((value) => value + 1); }}>Try again</SheetButton>
              </div>
            </div>
          ) : null}

          {hand ? (
            <section className={styles.hand} aria-label="Test hand">
              <header className={styles.handHead}>
                <h2 className={styles.sectionTitle}>Test hand <span className={cx(ui.num, styles.sectionTarget)}>{hand.drawn.length} {hand.drawn.length === 1 ? "card" : "cards"} · {hand.pile.length} left</span></h2>
                <div className={styles.sectionActions}>
                  <SheetButton kind="quiet" size="sm" disabled={hand.pile.length === 0} onClick={() => setHand({ drawn: [...hand.drawn, hand.pile[0]!], pile: hand.pile.slice(1) })}>Draw</SheetButton>
                  <SheetButton kind="quiet" size="sm" onClick={dealHand}>New hand</SheetButton>
                  <button type="button" className={styles.toolIcon} aria-label="Close test hand" onClick={() => setHand(null)}>
                    <X size={15} aria-hidden />
                  </button>
                </div>
              </header>
              <ul className={styles.handCards}>
                {hand.drawn.map((code, index) => (
                  <li key={`${index}-${code}`}>
                    <button type="button" className={styles.card} aria-label={cardName(code)} title={cardName(code)} onClick={() => inspect(code)}>
                      <CardArt code={code} name={cardName(code)} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {mode === "domain" ? (
            <section
              className={styles.master}
              aria-label="Deck Master"
              data-dropping={masterDropping ? "true" : undefined}
              onDragOver={(event) => {
                if (!hasCardDrag(event)) return;
                event.preventDefault();
                setMasterDropping(true);
              }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMasterDropping(false); }}
              onDrop={(event) => {
                setMasterDropping(false);
                const drag = readCardDrag(event);
                if (!drag || drag.from === "master") return;
                event.preventDefault();
                makeMaster(drag.code, drag.from === "list" ? undefined : drag.from);
              }}
            >
              <div className={styles.masterSlot}>
                {deck.deckMaster != null ? (
                  <button
                    type="button"
                    className={styles.card}
                    aria-label={`Deck Master: ${cardName(deck.deckMaster)}`}
                    aria-pressed={inspectCode === deck.deckMaster && selected == null}
                    title={cardName(deck.deckMaster)}
                    draggable
                    onClick={() => inspect(deck.deckMaster!)}
                    onDragStart={(event) => writeCardDrag(event, { code: deck.deckMaster!, from: "master" })}
                    onContextMenu={(event) => { event.preventDefault(); commit(selectDomainMaster(selection, undefined)); }}
                  >
                    <CardArt code={deck.deckMaster} name={cardName(deck.deckMaster)} />
                  </button>
                ) : (
                  <Crown size={22} strokeWidth={1.3} aria-hidden />
                )}
              </div>
              <div className={styles.masterText}>
                <h2 className={styles.sectionTitle}>Deck Master</h2>
                <p className={ui.hint}>
                  {deck.deckMaster != null
                    ? cardName(deck.deckMaster)
                    : "Drag a monster here, or select one and press Use as Deck Master."}
                </p>
                {deck.deckMaster != null ? (
                  <SheetButton kind="quiet" size="sm" disabled={busy} onClick={() => commit(selectDomainMaster(selection, undefined))}>
                    Clear
                  </SheetButton>
                ) : null}
              </div>
            </section>
          ) : null}

          <DeckSectionGrid
            {...sectionProps}
            title="Main"
            section="main"
            codes={deck.main}
            target={mode === "domain" ? "/ 60" : "/ 40–60"}
            tone={mainTone(mode, deck.main.length)}
            emptyHint="Add cards from the list on the right."
            actions={clearButton("main", "Main")}
          />
          <DeckSectionGrid
            {...sectionProps}
            title="Extra"
            section="extra"
            codes={deck.extra}
            target="/ 15"
            tone={deck.extra.length > 15 ? "bad" : undefined}
            emptyHint="Fusion, Synchro, Xyz and Link Monsters go here."
            actions={clearButton("extra", "Extra")}
          />
          <DeckSectionGrid
            {...sectionProps}
            title="Side"
            section="side"
            codes={deck.side}
            target={mode === "domain" ? "not used in Domain" : "/ 15"}
            tone={deck.side.length > 15 || (mode === "domain" && deck.side.length > 0) ? "bad" : undefined}
            emptyHint="Drag cards here, or use + Side on a selected card."
            actions={clearButton("side", "Side")}
          />
        </main>

        <CardBrowser
          query={query}
          onQueryChange={setQuery}
          archetypes={archetypes}
          limits={limits}
          view={view}
          onViewChange={setView}
          deckCount={deckCount}
          inspectCode={selected == null ? inspectCode : null}
          onInspect={(card) => { rememberCatalog([card]); inspect(card.code); }}
          onAdd={(card) => addFromList(card)}
          onCatalog={rememberCatalog}
          onRemoveDrop={(drag) => removeCopy(drag)}
          searchRef={searchRef}
        />
      </div>
    </div>
  );
}
