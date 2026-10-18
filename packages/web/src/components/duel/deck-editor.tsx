"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canonicalCardCode, type DeckCardInfo, type DuelDeck, type DuelDeckValidation, type DuelMode, type DuelSettings, type GenesysCard } from "@yugidraft/shared/duels";
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2, X } from "lucide-react";
import { cardArtUrl } from "./constants";
import { cx, SheetButton } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./deck-editor.module.css";
import { applyDomainMaster, selectDomainMaster, serializeYdk, type DeckMasterSelection } from "./ydk";
import { DeckValidationSkippedError, validateDuelDeck } from "./api";
import { DeckMasterPicker } from "./deck-master-picker";
import { canBeDeckMaster, isSpellOrTrapType, SPELL_TRAP_MASTER_MESSAGE, useDeckCardMeta, type DeckCardMeta } from "./deck-card-types";
import { SavedDeckPicker, useSavedDecks } from "./saved-deck-picker";
import { createSavedDeck, listSavedDecks, prepareDeckTextImport } from "../decks/api";
import { deckNameFromFile } from "../decks/import";
import { modeLabel } from "../decks/model";
import { GenesysBadge, GenesysCheck, GenesysMeter } from "../decks/genesys-ui";
import { useGenesysDeckSummary } from "../decks/use-genesys-deck";
import { findSavedDuplicate, pastedDeckName, prepareImportSave, uniqueDeckName } from "./import-save";
import { CardAddField } from "./card-add-field";

/** A hung request must not block the saves after it. */
const SAVE_TIMEOUT_MS = 15_000;

type CardProblem = { name?: string; messages: string[] };

function Section({
  title,
  section,
  codes,
  onRemove,
  problems,
  target,
  onChooseMaster,
  cardMeta,
  onPreview,
  genesysCard,
}: {
  title: string;
  section: "main" | "extra" | "side";
  codes: number[];
  onRemove: (index: number) => void;
  problems: ReadonlyMap<string, CardProblem>;
  target?: string;
  onChooseMaster?: (code: number) => void;
  /** Card names and type bitmasks by passcode; the Master control shows only for monsters. */
  cardMeta?: ReadonlyMap<number, DeckCardMeta>;
  onPreview?: (code: number) => void;
  /** Genesys room: the points mark of a card, once its details are in. */
  genesysCard?: (code: number) => Pick<DeckCardInfo, "type" | "genesysPoints"> | undefined;
}) {
  return (
    <section className={styles.list} aria-label={`${title} deck`}>
      <h3 className={styles.listHead}>
        <span className={styles.listTitle}>{title}</span>
        <span className={cx(ui.num, styles.count)}>{codes.length}</span>
        {target ? <span className={styles.target}>{target}</span> : null}
      </h3>
      {codes.length === 0 ? (
        <p className={styles.empty}>Empty</p>
      ) : (
        <ul className={styles.cards}>
          {codes.map((code, index) => {
            const problem = problems.get(`${section}:${index}`);
            const reason = problem?.messages.join(" ");
            const meta = cardMeta?.get(code);
            const cardName = meta?.name ?? problem?.name ?? code;
            return (
              <li key={`${title}-${index}-${code}`}>
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => onRemove(index)}
                  onMouseEnter={() => onPreview?.(code)}
                  onFocus={() => onPreview?.(code)}
                  aria-label={`Remove ${cardName} from ${title}${reason ? `. Invalid: ${reason}` : ""}`}
                  title={reason ? `${reason} Click to remove this copy.` : "Click to remove this copy"}
                  data-invalid={problem ? "true" : undefined}
                >
                  <img src={cardArtUrl(code, "small")} alt="" loading="lazy" />
                  <GenesysBadge card={genesysCard?.(code)} lift={Boolean(problem)} />
                  {problem ? (
                    <span className={styles.invalidTag}><AlertTriangle size={11} strokeWidth={1.8} aria-hidden />Invalid</span>
                  ) : null}
                  <span className={styles.removeVeil}><X size={16} strokeWidth={1.6} aria-hidden />Remove</span>
                </button>
                {onChooseMaster && meta && canBeDeckMaster(meta.type) ? (
                  <button type="button" className={styles.chooseMaster}
                    aria-label={`Use ${meta.name} as Deck Master`}
                    onClick={() => onChooseMaster(code)}>
                    Master
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function DeckEditor({
  slug,
  mode,
  settings,
  initial,
  busy,
  locked = false,
  onLocked,
  onReady,
  onPreviewCard,
}: {
  slug: string;
  mode: DuelMode;
  settings: DuelSettings;
  initial: DuelDeck | null;
  busy: boolean;
  /** The duel is starting or live: decks are locked, so no deck check runs. */
  locked?: boolean;
  /** The server answered a deck check with "locked": the room changed, so refresh it. */
  onLocked?: () => void;
  onReady: (deck: DuelDeck) => void;
  /** Called with the passcode of the deck card under the pointer or focus. */
  onPreviewCard?: (code: number) => void;
}) {
  const [selection, setSelection] = useState<DeckMasterSelection>(() => ({
    deck: initial ?? { main: [], extra: [], side: [] },
    masterOrigin: null,
  }));
  const { deck } = selection;
  const { main, extra, side, deckMaster: masterCode } = deck;
  const [paste, setPaste] = useState(initial ? serializeYdk(initial) : "");
  const [parseError, setParseError] = useState<string | null>(null);
  const [importReport, setImportReport] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const importRequest = useRef(0);
  useEffect(() => () => { importRequest.current += 1; }, []);
  const [edited, setEdited] = useState(false);
  // The deck as it came from the room or a saved deck. Replacing it asks for no confirmation.
  const [pristineDeck, setPristineDeck] = useState<DuelDeck>(deck);
  const [retry, setRetry] = useState(0);
  const cardMeta = useDeckCardMeta(deck, { enabled: mode === "domain", retry });
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const savedList = useSavedDecks(slug);
  const importSeq = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [saveNote, setSaveNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [validation, setValidation] = useState<{
    slug: string;
    deck: DuelDeck;
    report?: DuelDeckValidation;
    error?: string;
    /** The room moved on while the check ran; nothing to show. */
    locked?: boolean;
  } | null>(null);
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;
  const sideAllowed = mode === "normal" || !settings.validateDeck;
  // A Genesys room: the points of the deck, read only. The server check is what the Ready button waits for.
  const genesysDeck = useGenesysDeckSummary(deck, mode, settings.genesys);
  const genesysCard = settings.genesys
    ? (code: number): Pick<DeckCardInfo, "type" | "genesysPoints"> | undefined => {
        const own = genesysDeck.catalog.get(code);
        if (!own) return undefined;
        const main: GenesysCard | undefined = genesysDeck.catalog.get(canonicalCardCode(code, genesysDeck.catalog));
        return { type: own.type, genesysPoints: main?.genesysPoints };
      }
    : undefined;

  const currentValidation = validation?.slug === slug && validation.deck === deck ? validation : null;
  const report = currentValidation?.report;
  const showValidation = edited || initial !== null;
  const canReady = report !== undefined && report.issues.length === 0 && !parseError;
  const problems = useMemo(() => {
    const byPosition = new Map<string, CardProblem>();
    for (const issue of report?.issues ?? []) {
      for (const card of issue.cards) {
        const key = `${card.section}:${card.index}`;
        const existing = byPosition.get(key);
        if (existing) existing.messages.push(issue.message);
        else byPosition.set(key, { name: card.name, messages: [issue.message] });
      }
    }
    return byPosition;
  }, [report]);
  const masterProblem = problems.get("deckMaster:0");
  // The server check says the same once it answers; this shows it as soon as the card is known.
  const masterMessage = masterProblem?.messages.join(" ")
    ?? (mode === "domain" && masterCode != null && isSpellOrTrapType(cardMeta.get(masterCode)?.type) ? SPELL_TRAP_MASTER_MESSAGE : undefined);
  const leadCard = masterCode ?? main[0] ?? extra[0];

  useEffect(() => {
    if (leadCard != null) onPreviewCard?.(leadCard);
    // Only a new lead card resets the preview; hovering keeps control otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadCard]);

  useEffect(() => {
    if (locked) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void validateDuelDeck(slug, deck, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setValidation({ slug, deck, report: result });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          if (error instanceof DeckValidationSkippedError) {
            setValidation({ slug, deck, locked: true });
            onLockedRef.current?.();
            return;
          }
          setValidation({ slug, deck, error: error instanceof Error ? error.message : "Could not validate this deck." });
        },
      );
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, deck, retry, locked]);

  function commitSelection(next: DeckMasterSelection) {
    importRequest.current += 1;
    setImportReport("");
    setSelection(next);
    setPaste(serializeYdk(next.deck));
    setEdited(true);
    setParseError(null);
  }

  /** Saves an import to the player's decks, as given. A failed save never blocks the import itself. */
  async function saveImported(raw: DuelDeck, baseName: string, seq: number) {
    // Only the newest import shows a note; an older save that ends later stays silent.
    const note = (next: { text: string; error?: boolean }) => { if (seq === importSeq.current) setSaveNote(next); };
    try {
      if (raw.main.length + raw.extra.length + raw.side.length === 0 && raw.deckMaster === undefined) return;
      const prepared = prepareImportSave(raw, mode);
      if (!prepared.ok) {
        note({ text: "Not saved to your decks: saved Domain decks have no Side Deck." });
        return;
      }
      const existing = savedList.latest.current ?? await listSavedDecks(AbortSignal.timeout(SAVE_TIMEOUT_MS));
      const duplicate = findSavedDuplicate(existing, prepared.mode, prepared.deck, settings.genesys);
      if (duplicate) {
        note({ text: `Already in your decks: ${duplicate.name}` });
        return;
      }
      const name = uniqueDeckName(baseName, existing.map((entry) => entry.name));
      const created = await createSavedDeck({ name, mode: prepared.mode, deck: prepared.deck, ...(settings.genesys ? { genesys: settings.genesys } : {}) }, AbortSignal.timeout(SAVE_TIMEOUT_MS));
      savedList.add(created);
      note({
        text: prepared.mode === mode
          ? `Saved to your decks as ${created.name}`
          : `Saved to your decks as ${created.name}, as a ${modeLabel(prepared.mode)} deck because it has a Deck Master.`,
      });
    } catch (error) {
      note({ text: `Could not save to your decks: ${error instanceof Error ? error.message : "try again later."}`, error: true });
    }
  }

  /** Saves run one after the other, so each one reads the list after the save before it. */
  function queueSave(raw: DuelDeck, baseName: string) {
    importSeq.current += 1;
    const seq = importSeq.current;
    saveQueue.current = saveQueue.current.then(() => saveImported(raw, baseName, seq)).catch(() => undefined);
  }

  function applyImported(raw: DuelDeck, baseName: string, messages: string[] = []) {
    setSaveNote(null);
    queueSave(raw, baseName);
    const imported = mode === "domain"
      ? settings.validateDeck && raw.side.length <= 1 ? applyDomainMaster(raw) : raw
      : { main: raw.main, extra: raw.extra, side: raw.side };
    const extractedSideMaster = imported.deckMaster !== undefined && raw.deckMaster === undefined
      && raw.side.length === 1 && imported.side.length === 0;
    commitSelection({ deck: imported, masterOrigin: extractedSideMaster ? { section: "side", index: 0 } : null });
    setImportReport(messages.join(" "));
  }

  function chooseMaster(code?: number) {
    commitSelection(selectDomainMaster(selection, code));
  }

  function removeCard(section: "main" | "extra" | "side", index: number) {
    const origin = selection.masterOrigin;
    commitSelection({
      deck: { ...deck, [section]: deck[section].filter((_, i) => i !== index) },
      masterOrigin: origin?.section === section && index < origin.index
        ? { ...origin, index: origin.index - 1 }
        : origin,
    });
  }

  function onFile(file: File) {
    const generation = ++importRequest.current;
    setFileName(file.name);
    void file.text().then((text) => prepareDeckTextImport(text, mode)).then((prepared) => {
      if (generation === importRequest.current) applyImported(prepared.deck, deckNameFromFile(file.name), prepared.messages);
    }).catch((error: unknown) => {
      if (generation === importRequest.current) setParseError(error instanceof Error ? error.message : "Could not read that file.");
    });
  }

  async function onPasteApply() {
    const generation = ++importRequest.current;
    setPasteBusy(true);
    try {
      const prepared = await prepareDeckTextImport(paste, mode);
      if (generation !== importRequest.current) return;
      const deck = prepared.deck;
      if (deck.main.length === 0 && deck.extra.length === 0 && deck.side.length === 0 && deck.deckMaster === undefined) {
        setParseError("No cards found. Paste a YDK deck or a ydke:// link.");
        return;
      }
      applyImported(deck, pastedDeckName(new Date()), prepared.messages);
    } catch (error) {
      if (generation === importRequest.current) setParseError(error instanceof Error ? error.message : "Could not parse that deck.");
    } finally {
      // The button state belongs to this click, not to the deck generation: a later edit must not leave it busy.
      setPasteBusy(false);
    }
  }

  function addCard(code: number, addSection: "main" | "extra" | "side") {
    const section = addSection === "side" && !sideAllowed ? "main" : addSection;
    commitSelection({ ...selection, deck: { ...deck, [section]: [...deck[section], code] } });
  }

  function submit() {
    if (!canReady || busy) return;
    onReady(deck);
  }

  const rulesNote = !settings.validateDeck
    ? `Custom deck: format and copy-limit checks are disabled. Card-pool and engine-safety restrictions still apply.${mode === "domain" ? " Choose a separate monster Deck Master." : ""}`
    : mode === "domain"
      ? "Domain: exactly 60 singleton Main Deck cards, up to 15 Extra Deck cards, and one separate Deck Master. The master determines your Domain; there is no separate leader or Domain selection."
      : "Normal: 40–60 Main Deck cards and up to 15 each in Extra and Side. To use a Deck Master, create a Domain table instead.";
  const genesysNote = settings.genesys
    ? `Genesys: the points of all your cards, ${mode === "domain" ? "the Deck Master included, " : ""}must stay within ${settings.genesys.pointCap}. Link and Pendulum Monsters are not allowed. Points replace the banlist.`
    : "";
  const mainTarget = !settings.validateDeck ? undefined : mode === "domain" ? "of 60" : "40–60";
  const extraTarget = settings.validateDeck ? "up to 15" : undefined;
  const sideTarget = settings.validateDeck && mode === "normal" ? "up to 15" : undefined;

  return (
    <div className={styles.editor}>
      <header className={styles.head}>
        <div className={styles.headRow}>
          <div className={styles.headTitle}>
            <h2 className={ui.sectionTitle}>Your deck</h2>
            <p className={styles.counts} aria-label="Deck counts">
              <span>Main <b className={ui.num}>{main.length}</b></span>
              <span>Extra <b className={ui.num}>{extra.length}</b></span>
              {sideAllowed || side.length > 0 ? <span>Side <b className={ui.num}>{side.length}</b></span> : null}
            </p>
          </div>
          <SheetButton kind="primary" size="lg" loading={busy} disabled={busy || locked || !canReady} onClick={submit}>
            Ready with this deck
          </SheetButton>
        </div>
        <p className={styles.rules}><Info size={15} strokeWidth={1.6} aria-hidden /><span>{rulesNote}{genesysNote ? ` ${genesysNote}` : ""}</span></p>
        {genesysDeck.summary ? <GenesysMeter summary={genesysDeck.summary} wide /> : null}
        {genesysDeck.summary ? <GenesysCheck summary={genesysDeck.summary} /> : null}
      </header>

      <SavedDeckPicker mode={mode} genesys={settings.genesys} disabled={busy} list={savedList}
        onBeforeEdit={() => {
          // The editor opens in this tab, so the deck changed here by hand is lost: ask first. A deck from the room or
          // a saved deck that was not changed leaves nothing behind.
          const changed = deck !== pristineDeck && (main.length > 0 || extra.length > 0 || side.length > 0 || masterCode !== undefined);
          return !changed || window.confirm("You changed the deck at this table. If you open the deck editor, those changes are lost. Open the editor?");
        }}
        onLoad={(saved) => {
        const hasCards = main.length > 0 || extra.length > 0 || side.length > 0 || masterCode !== undefined;
        if (hasCards && deck !== pristineDeck
          && !window.confirm("Replace the deck you changed at this table? Your saved deck is unchanged.")) return false;
        const localDeck = mode === "normal"
          ? { main: saved.main, extra: saved.extra, side: saved.side }
          : saved;
        commitSelection({ deck: localDeck, masterOrigin: null });
        setPristineDeck(localDeck);
        setFileName(null);
        return true;
      }} />

      {showValidation && !locked && !currentValidation?.locked ? (
        <div aria-live="polite" role="status">
          {currentValidation?.error ? (
            <div className={cx(ui.banner, ui.bannerBad)}>
              <AlertTriangle size={17} strokeWidth={1.6} aria-hidden />
              <div className={ui.bannerBody}>
                <strong>Deck could not be checked</strong>
                <p>{currentValidation.error}</p>
                <div><SheetButton size="sm" onClick={() => {
                  setValidation(null);
                  setRetry((value) => value + 1);
                }}>Retry validation</SheetButton></div>
              </div>
            </div>
          ) : !report ? (
            <div className={ui.banner}>
              <Loader2 size={17} strokeWidth={1.6} className={ui.spin} aria-hidden />
              <p>Checking deck against this room&apos;s rules…</p>
            </div>
          ) : report.issues.length > 0 ? (
            <div className={cx(ui.banner, ui.bannerBad)}>
              <AlertTriangle size={17} strokeWidth={1.6} aria-hidden />
              <div className={ui.bannerBody}>
                <strong>Invalid deck — fix the following before readying</strong>
                <ul className={ui.bannerList}>
                  {report.issues.map((issue, index) => (
                    <li key={index}>
                      {issue.message}
                      {issue.cards.length > 1 ? <span className={styles.muted}> ({issue.cards.length} highlighted cards)</span> : null}
                    </li>
                  ))}
                </ul>
                {problems.size > 0 ? (
                  <p className={styles.muted}>Your imported cards are kept below. Click a red-outlined card to remove that copy.</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={cx(ui.banner, ui.bannerOk)}>
              <CheckCircle2 size={17} strokeWidth={1.6} aria-hidden />
              <p>Deck is valid for this room. You can ready up.</p>
            </div>
          )}
        </div>
      ) : null}


      <div className={styles.import}>
        <label className={styles.drop} data-dragging={dragging ? "true" : undefined}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}>
          <input
            type="file"
            accept=".ydk,text/plain"
            className={ui.srOnly}
            aria-label="YDK file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
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
              onChange={(event) => setPaste(event.target.value)}
              rows={6}
              className={cx(ui.input, ui.textarea)}
              spellCheck={false}
              placeholder={"#main\n46986414\n#extra\n!side"}
            />
          </label>
          <SheetButton size="sm" loading={pasteBusy} onClick={onPasteApply}>{pasteBusy ? "Importing…" : "Load paste"}</SheetButton>
        </div>
      </div>
      {saveNote ? (
        saveNote.error
          ? <p role="alert" className={ui.alert}>{saveNote.text}</p>
          : <p role="status" className={styles.muted}>{saveNote.text}</p>
      ) : null}

      {mode === "domain" ? (
        <DeckMasterPicker code={masterCode} onChange={chooseMaster}
          problem={masterMessage} custom={!settings.validateDeck} />
      ) : null}

      <CardAddField mode={mode} slug={slug} settings={settings} sideAllowed={sideAllowed} onAdd={addCard} onError={setParseError} />

      {importReport ? <p role="status" className={styles.importReport}>{importReport}</p> : null}
      {parseError ? <p role="alert" className={ui.alert}>{parseError}</p> : null}

      <Section title="Main" section="main" codes={main} problems={problems} target={mainTarget}
        onRemove={(index) => removeCard("main", index)} onPreview={onPreviewCard} onChooseMaster={mode === "domain" ? chooseMaster : undefined} cardMeta={cardMeta} genesysCard={genesysCard} />
      <Section title="Extra" section="extra" codes={extra} problems={problems} target={extraTarget}
        onRemove={(index) => removeCard("extra", index)} onPreview={onPreviewCard} onChooseMaster={mode === "domain" ? chooseMaster : undefined} cardMeta={cardMeta} genesysCard={genesysCard} />
      {sideAllowed || side.length > 0 ? (
        <Section title="Side" section="side" codes={side} problems={problems} target={sideTarget}
          onRemove={(index) => removeCard("side", index)} onPreview={onPreviewCard} onChooseMaster={mode === "domain" ? chooseMaster : undefined} cardMeta={cardMeta} genesysCard={genesysCard} />
      ) : null}
    </div>
  );
}
