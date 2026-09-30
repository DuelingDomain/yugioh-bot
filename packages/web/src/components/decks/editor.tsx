"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { DuelCardInfo, DuelDeck, DuelMode, SavedDeck } from "@yugidraft/shared/duels";
import { AlertTriangle, ArrowLeft, Download, FileUp, Save } from "lucide-react";
import { getDuelCards } from "@/components/duel/api";
import { DeckMasterPicker } from "@/components/duel/deck-master-picker";
import { CardInspector, type InspectTarget } from "@/components/duel/inspector";
import { parseDeckText, selectDomainMaster, serializeYdk, type DeckMasterSelection } from "@/components/duel/ydk";
import { cx, SheetButton, SheetSegmented, sheetButtonClass, sheetRoot } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { createSavedDeck, deleteSavedDeck, getSavedDeck, updateSavedDeck } from "./api";
import { useNavigationLeaveGuard } from "@/lib/hooks/use-duel-leave-guard";
import {
  DEFAULT_NAME,
  EMPTY_DECK,
  MAX_NAME_LENGTH,
  addCode,
  allCodes,
  cardLabel,
  cloneDeck,
  downloadYdkFile,
  guidanceNotes,
  importForLibrary,
  isNewDeckDirty,
  moveOne,
  removeOne,
  shiftMasterOrigin,
  snapshotOf,
  uniqueCodes,
  type DeckSection,
  type SelectedStack,
} from "./model";
import { DeckSearchPanel } from "./search-panel";
import { DeckSectionGrid } from "./section-grid";
import styles from "./editor.module.css";

const MODE_CHOICES = [
  { value: "normal" as const, label: "Standard" },
  { value: "domain" as const, label: "Domain" },
] as const;

function parseRouteId(raw: string | undefined): number | "new" | "invalid" {
  if (raw == null || raw === "") return "new";
  if (!/^\d+$/.test(raw)) return "invalid";
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return "invalid";
  return id;
}

export function SavedDeckEditor({ deckId }: { deckId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const routeId = parseRouteId(deckId ?? (/^\/decks\/(\d+)$/.exec(pathname)?.[1]));

  const [savedId, setSavedId] = useState<number | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [mode, setMode] = useState<DuelMode>("normal");
  const [selection, setSelection] = useState<DeckMasterSelection>({ deck: EMPTY_DECK, masterOrigin: null });
  const [baseline, setBaseline] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(routeId === "invalid" ? "That deck id is not valid." : null);
  const [loading, setLoading] = useState(typeof routeId === "number");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Map<number, DuelCardInfo>>(() => new Map());
  const [unknown, setUnknown] = useState<Set<number>>(() => new Set());
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaRetry, setMetaRetry] = useState(0);
  const [metaLoading, setMetaLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedStack | null>(null);
  const [inspectCode, setInspectCode] = useState<number | null>(null);
  const importGeneration = useRef(0);

  useEffect(() => () => { importGeneration.current += 1; }, []);

  const { deck, masterOrigin } = selection;
  const dirty = baseline == null ? isNewDeckDirty(name, mode, deck) : snapshotOf(name.trim(), mode, deck) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useNavigationLeaveGuard(dirty, "You have unsaved deck changes. Leave without saving?");

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
    if (needed.length === 0) {
      setMetaLoading(false);
      return;
    }
    let cancelled = false;
    setMetaLoading(true);
    setMetaError(null);
    void getDuelCards(needed).then(
      ({ cards, missing }) => {
        if (cancelled) return;
        setCatalog((prev) => {
          const next = new Map(prev);
          for (const card of cards) next.set(card.code, card);
          return next;
        });
        setUnknown((prev) => {
          const next = new Set(prev);
          for (const code of missing) next.add(code);
          return next;
        });
        setMetaLoading(false);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setBlocked((prev) => {
          const next = new Set(prev);
          for (const code of needed) next.add(code);
          return next;
        });
        setMetaError(reason instanceof Error ? reason.message : "Could not load card details.");
        setMetaLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [deck, metaRetry]);

  function applyRecord(record: SavedDeck) {
    setSavedId(record.id);
    setName(record.name);
    setMode(record.mode);
    setSelection({ deck: cloneDeck(record.deck), masterOrigin: null });
    setPaste(serializeYdk(record.deck));
    setParseError(null);
    setBaseline(snapshotOf(record.name, record.mode, record.deck));
  }

  function commit(next: DeckMasterSelection) {
    importGeneration.current += 1;
    setSelection(next);
    setPaste(serializeYdk(next.deck));
    setParseError(null);
    setSavedFlash(false);
  }

  const rememberCatalog = useCallback((cards: DuelCardInfo[]) => {
    setCatalog((prev) => {
      const next = new Map(prev);
      for (const card of cards) next.set(card.code, card);
      return next;
    });
  }, []);

  function addCard(card: DuelCardInfo, section: DeckSection) {
    rememberCatalog([card]);
    commit({ ...selection, deck: addCode(deck, section, card.code) });
    setSelected({ section, code: card.code });
    setInspectCode(card.code);
  }

  function chooseMaster(code?: number) {
    commit(selectDomainMaster(selection, code));
    if (code != null) setInspectCode(code);
  }

  function applyImported(raw: DuelDeck) {
    if (allCodes(raw).length === 0) {
      throw new Error("No cards found. Import a YDK deck or a ydke:// link.");
    }
    commit(importForLibrary(raw, mode));
    setSelected(null);
  }

  function onFile(file: File) {
    if (saveBusy || deleteBusy) return;
    const generation = ++importGeneration.current;
    setFileName(file.name);
    void file.text().then(
      (text) => {
        if (generation !== importGeneration.current) return;
        try {
          applyImported(parseDeckText(text));
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

  function onPasteApply() {
    importGeneration.current += 1;
    try {
      applyImported(parseDeckText(paste));
    } catch (reason: unknown) {
      setParseError(reason instanceof Error ? reason.message : "Could not parse that deck.");
    }
  }

  function removeSelected() {
    if (!selected) return;
    const removed = removeOne(deck, selected.section, selected.code);
    if (removed.removedIndex < 0) return;
    const nextDeck = removed.deck;
    commit({
      deck: nextDeck,
      masterOrigin: shiftMasterOrigin(masterOrigin, selected.section, removed.removedIndex),
    });
    if (!nextDeck[selected.section].includes(selected.code)) setSelected(null);
  }

  function addSelectedCopy() {
    if (!selected) return;
    commit({ ...selection, deck: addCode(deck, selected.section, selected.code) });
  }

  function moveSelected(to: DeckSection) {
    if (!selected || selected.section === to) return;
    const nextDeck = moveOne(deck, selected.section, to, selected.code);
    const removedIndex = deck[selected.section].lastIndexOf(selected.code);
    commit({
      deck: nextDeck,
      masterOrigin: shiftMasterOrigin(masterOrigin, selected.section, removedIndex),
    });
    setSelected({ section: to, code: selected.code });
  }

  async function save() {
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


  const notes = guidanceNotes(mode, deck);
  const inspected = inspectCode == null ? undefined : catalog.get(inspectCode);
  const inspectTarget: InspectTarget | null = inspected ? { type: "info", card: inspected } : null;
  const selectedName = selected ? cardLabel(selected.code, catalog) : null;
  const selectedCount = selected ? deck[selected.section].filter((code) => code === selected.code).length : 0;
  const mainTarget = mode === "domain" ? "of 60" : "40–60";
  const extraTarget = "up to 15";
  const sideTarget = mode === "domain" ? "kept on this save" : "up to 15";
  const statusTone = saveError ? "bad" : dirty ? "warn" : savedFlash || savedId != null ? "ok" : undefined;
  const statusText = saveBusy
    ? "Saving…"
    : saveError
      ? saveError
      : dirty
        ? "Unsaved changes"
        : savedFlash
          ? "Saved"
          : savedId != null
            ? "Saved"
            : "New unsaved deck";

  if (routeId === "invalid" || (loadError && savedId == null)) {
    return (
      <div className={cx(sheetRoot, styles.wrap)}>
        <div className={styles.loadError}>
          <p role="alert" className={ui.alert}>{loadError ?? "That deck id is not valid."}</p>
          <Link href="/decks" className={sheetButtonClass("secondary")}>Back to decks</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cx(sheetRoot, styles.wrap)}>
        <p className={ui.hint}>Loading deck…</p>
      </div>
    );
  }

  return (
    <fieldset className={cx(sheetRoot, styles.wrap)} disabled={saveBusy || deleteBusy} aria-label="Deck editor">
      <header className={styles.toolbar}>
        <div className={styles.toolbarLead}>
          <Link href="/decks" className={sheetButtonClass("quiet", "sm")}>
            <ArrowLeft size={16} strokeWidth={1.6} aria-hidden />
            Decks
          </Link>
          <p className={styles.counts} aria-label="Deck counts">
            <span>Main <b className={ui.num}>{deck.main.length}</b></span>
            <span>Extra <b className={ui.num}>{deck.extra.length}</b></span>
            <span>Side <b className={ui.num}>{deck.side.length}</b></span>
            {deck.deckMaster != null ? <span>Master <b className={ui.num}>1</b></span> : null}
          </p>
        </div>
        <div className={styles.toolbarActions}>
          <p className={styles.status} data-tone={statusTone} aria-live="polite">{statusText}</p>
          <SheetButton kind="primary" loading={saveBusy} disabled={saveBusy} onClick={() => void save()}>
            <Save size={16} strokeWidth={1.6} aria-hidden />
            Save
          </SheetButton>
          <SheetButton onClick={() => downloadYdkFile(name, deck)}>
            <Download size={16} strokeWidth={1.6} aria-hidden />
            Export YDK
          </SheetButton>
          {savedId != null ? (
            deleteOpen ? (
              <div className={styles.confirm}>
                <p>Delete {name.trim() || "this deck"}?</p>
                {deleteError ? <p role="alert" className={ui.alert}>{deleteError}</p> : null}
                <div className={styles.actionRow}>
                  <SheetButton kind="danger" size="sm" loading={deleteBusy} disabled={deleteBusy} onClick={() => void confirmDelete()}>
                    Delete
                  </SheetButton>
                  <SheetButton kind="quiet" size="sm" disabled={deleteBusy} onClick={() => { setDeleteOpen(false); setDeleteError(null); }}>
                    Keep
                  </SheetButton>
                </div>
              </div>
            ) : (
              <SheetButton kind="danger" size="sm" onClick={() => setDeleteOpen(true)}>Delete</SheetButton>
            )
          ) : null}
        </div>
      </header>

      <div className={styles.identity}>
        <label className={styles.nameField}>
          <span className={ui.label}>Deck name</span>
          <input
            className={ui.input}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => { importGeneration.current += 1; setName(event.target.value); setSavedFlash(false); }}
          />
        </label>
        <SheetSegmented
          label="Format"
          value={mode}
          choices={MODE_CHOICES}
          onChange={(value) => { importGeneration.current += 1; setMode(value); setSavedFlash(false); }}
        />
      </div>

      <details className={styles.guidance}>
        <summary>Private deck · Legality is checked when you ready up{notes.length ? ` · ${notes.length} deck-building note${notes.length === 1 ? "" : "s"}` : ""}</summary>
        <p className={ui.hint}>You can save unfinished decks. Saving does not certify that a deck is legal for a table.</p>
        {notes.length > 0 ? <ul className={ui.bannerList}>{notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      </details>

      {metaError ? (
        <div className={cx(ui.banner, ui.bannerBad)}>
          <AlertTriangle size={17} strokeWidth={1.6} aria-hidden />
          <div className={ui.bannerBody}>
            <strong>Card details unavailable</strong>
            <p>{metaError} Passcodes stay in the list.</p>
            <SheetButton size="sm" onClick={() => { setBlocked(new Set()); setMetaRetry((value) => value + 1); }}>Retry details</SheetButton>
          </div>
        </div>
      ) : null}

      {metaLoading ? <p className={ui.hint}>Loading card details…</p> : null}

      <div className={styles.workspace}>
        <div className={styles.inspect}>
          <div className={styles.inspectPane}>
            {inspectCode != null && !inspected
              ? <p className={styles.inspectNotice}>Passcode {inspectCode}: {unknown.has(inspectCode) ? "not in the engine catalog. The card is kept in your deck." : metaError ? "card details unavailable." : "loading card details…"}</p>
              : <CardInspector target={inspectTarget} />}
          </div>
          {selected && selectedName ? (
            <div className={styles.actions} aria-label="Selected card">
              <p className={styles.actionsName}>{selectedName}</p>
              <p className={ui.hint}>
                {selected.section === "main" ? "Main" : selected.section === "extra" ? "Extra" : "Side"}
                {" · "}
                {selectedCount} {selectedCount === 1 ? "copy" : "copies"}
                {unknown.has(selected.code) ? " · unavailable in catalog" : ""}
              </p>
              <div className={styles.actionRow}>
                <SheetButton size="sm" onClick={addSelectedCopy}>Add copy</SheetButton>
                <SheetButton size="sm" onClick={removeSelected}>Remove</SheetButton>
              </div>
              <p className={ui.label}>Move copy to</p>
              <div className={styles.actionRow}>
                <SheetButton size="sm" disabled={selected.section === "main"} onClick={() => moveSelected("main")}>Main</SheetButton>
                <SheetButton size="sm" disabled={selected.section === "extra"} onClick={() => moveSelected("extra")}>Extra</SheetButton>
                <SheetButton size="sm" disabled={selected.section === "side"} onClick={() => moveSelected("side")}>Side</SheetButton>
              </div>
              {mode === "domain" ? (
                <SheetButton size="sm" onClick={() => chooseMaster(selected.code)}>Use as Deck Master</SheetButton>
              ) : null}
            </div>
          ) : (
            <p className={ui.hint}>Select a card in the list to inspect it and add, remove, or move copies. Those controls stay visible here — nothing important is hover-only.</p>
          )}
        </div>

        <div className={styles.board}>
          <details className={styles.disclosure}>
            <summary><FileUp size={16} aria-hidden /> Import YDK / YDKE</summary>
          <div className={styles.import}>
            <label
              className={styles.drop}
              data-dragging={dragging ? "true" : undefined}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) onFile(file);
              }}
            >
              <input
                type="file"
                accept=".ydk,text/plain"
                className={ui.srOnly}
                aria-label="YDK file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFile(file);
                  event.target.value = "";
                }}
              />
              <FileUp size={22} strokeWidth={1.4} aria-hidden />
              <span className={styles.dropTitle}>{fileName ?? "Drop a .ydk file"}</span>
              <span className={styles.dropHint}>{fileName ? "Choose another file to replace it" : "or click to choose one"}</span>
            </label>
            <div className={styles.paste}>
              <label>
                <span className={ui.label}>Paste YDK or YDKE</span>
                <textarea
                  value={paste}
                  rows={6}
                  spellCheck={false}
                  className={cx(ui.input, ui.textarea)}
                  placeholder={"#main\n46986414\n#extra\n!side"}
                  onChange={(event) => { importGeneration.current += 1; setPaste(event.target.value); }}
                />
              </label>
              <SheetButton size="sm" onClick={onPasteApply}>Load paste</SheetButton>
            </div>
          </div>
          <p className={ui.hint}>
            Domain imports: a lone Side card with no #deckmaster becomes the Deck Master. Extra Side cards are kept.
            A new import replaces the previous master — it will not linger from the last file.
          </p>
          {parseError ? <p role="alert" className={ui.alert}>{parseError}</p> : null}
          </details>

          {mode === "domain" ? (
            <details className={styles.disclosure}>
              <summary>Deck Master · {deck.deckMaster == null ? "Choose a monster" : cardLabel(deck.deckMaster, catalog)}</summary>
              <DeckMasterPicker code={deck.deckMaster} onChange={chooseMaster} custom />
            </details>
          ) : null}

          <DeckSectionGrid
            title="Main"
            section="main"
            codes={deck.main}
            target={mainTarget}
            catalog={catalog}
            unknown={unknown}
            selected={selected}
            onSelect={(stack) => { setSelected(stack); setInspectCode(stack.code); }}
          />
          <DeckSectionGrid
            title="Extra"
            section="extra"
            codes={deck.extra}
            target={extraTarget}
            catalog={catalog}
            unknown={unknown}
            selected={selected}
            onSelect={(stack) => { setSelected(stack); setInspectCode(stack.code); }}
          />
          <DeckSectionGrid
            title="Side"
            section="side"
            codes={deck.side}
            target={sideTarget}
            catalog={catalog}
            unknown={unknown}
            selected={selected}
            onSelect={(stack) => { setSelected(stack); setInspectCode(stack.code); }}
          />
        </div>

        <DeckSearchPanel onAdd={addCard} onCatalog={rememberCatalog} />
      </div>
    </fieldset>
  );
}
