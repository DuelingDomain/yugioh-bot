"use client";

import { useEffect, useMemo, useState } from "react";
import type { DuelDeck, DuelDeckValidation, DuelMode, DuelSettings } from "@yugidraft/shared/duels";
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2, Plus, X } from "lucide-react";
import { cardArtUrl } from "./constants";
import { cx, SheetButton, SheetSelect } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./deck-editor.module.css";
import { applyDomainMaster, parseDeckText, serializeYdk } from "./ydk";
import { validateDuelDeck } from "./api";

type CardProblem = { name?: string; messages: string[] };

function Section({
  title,
  section,
  codes,
  onRemove,
  problems,
  target,
}: {
  title: string;
  section: "main" | "extra" | "side";
  codes: number[];
  onRemove: (index: number) => void;
  problems: ReadonlyMap<string, CardProblem>;
  target?: string;
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
            return (
              <li key={`${title}-${index}-${code}`}>
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${problem?.name ?? code} from ${title}${reason ? `. Invalid: ${reason}` : ""}`}
                  title={reason ? `${reason} Click to remove this copy.` : "Click to remove this copy"}
                  data-invalid={problem ? "true" : undefined}
                >
                  <img src={cardArtUrl(code, "small")} alt="" loading="lazy" />
                  {problem ? (
                    <span className={styles.invalidTag}><AlertTriangle size={11} strokeWidth={1.8} aria-hidden />Invalid</span>
                  ) : null}
                  <span className={styles.removeVeil}><X size={16} strokeWidth={1.6} aria-hidden />Remove</span>
                </button>
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
  onReady,
}: {
  slug: string;
  mode: DuelMode;
  settings: DuelSettings;
  initial: DuelDeck | null;
  busy: boolean;
  onReady: (deck: DuelDeck) => void;
}) {
  const [main, setMain] = useState<number[]>(initial?.main ?? []);
  const [extra, setExtra] = useState<number[]>(initial?.extra ?? []);
  const [side, setSide] = useState<number[]>(initial?.side ?? []);
  const [deckMaster, setDeckMaster] = useState<string>(
    initial?.deckMaster != null ? String(initial.deckMaster) : "",
  );
  const [paste, setPaste] = useState(initial ? serializeYdk(initial) : "");
  const [addCode, setAddCode] = useState("");
  const [addSection, setAddSection] = useState<"main" | "extra" | "side">("main");
  const [parseError, setParseError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const [retry, setRetry] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [validation, setValidation] = useState<{
    slug: string;
    deck: DuelDeck;
    report?: DuelDeckValidation;
    error?: string;
  } | null>(null);
  const sideAllowed = mode === "normal" || !settings.validateDeck;

  const masterCode = useMemo(() => {
    const n = Number(deckMaster);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }, [deckMaster]);

  const deck = useMemo<DuelDeck>(() => (
    mode === "domain" ? { main, extra, side, deckMaster: masterCode } : { main, extra, side }
  ), [mode, main, extra, side, masterCode]);
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

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void validateDuelDeck(slug, deck, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setValidation({ slug, deck, report: result });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setValidation({ slug, deck, error: error instanceof Error ? error.message : "Could not validate this deck." });
          }
        },
      );
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, deck, retry]);

  function applyImported(raw: DuelDeck) {
    const deck = mode === "domain" && settings.validateDeck && raw.side.length <= 1
      ? applyDomainMaster(raw, masterCode)
      : raw;
    setMain(deck.main);
    setExtra(deck.extra);
    setSide(deck.side);
    if (mode === "domain" && deck.deckMaster != null) setDeckMaster(String(deck.deckMaster));
    setPaste(serializeYdk(deck));
    setEdited(true);
    setParseError(null);
  }

  function onFile(file: File) {
    setFileName(file.name);
    file
      .text()
      .then((text) => applyImported(parseDeckText(text)))
      .catch((error: unknown) => setParseError(error instanceof Error ? error.message : "Could not read that file."));
  }

  function onPasteApply() {
    try {
      const deck = parseDeckText(paste);
      if (deck.main.length === 0 && deck.extra.length === 0) {
        setParseError("No cards found in that YDK.");
        return;
      }
      applyImported(deck);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Could not parse that deck.");
    }
  }

  function addPasscode() {
    const code = Number(addCode.trim());
    if (!Number.isInteger(code) || code <= 0) {
      setParseError("Enter a positive passcode.");
      return;
    }
    if (addSection === "extra") setExtra((current) => [...current, code]);
    else if (addSection === "side" && sideAllowed) setSide((current) => [...current, code]);
    else setMain((current) => [...current, code]);
    setAddCode("");
    setEdited(true);
    setParseError(null);
  }

  function submit() {
    if (!canReady || busy) return;
    onReady(deck);
  }

  const rulesNote = !settings.validateDeck
    ? `Custom deck: format and copy-limit checks are disabled. Card-pool and engine-safety restrictions still apply.${mode === "domain" ? " Enter a separate monster Deck Master passcode." : ""}`
    : mode === "domain"
      ? "Domain: exactly 60 singleton Main Deck cards, up to 15 Extra Deck cards, and one separate Deck Master. The master determines your Domain; there is no separate leader or Domain selection."
      : "Normal: 40–60 Main Deck cards and up to 15 each in Extra and Side. To use a Deck Master, create a Domain table instead.";
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
          <SheetButton kind="primary" size="lg" loading={busy} disabled={busy || !canReady} onClick={submit}>
            Ready with this deck
          </SheetButton>
        </div>
        <p className={styles.rules}><Info size={15} strokeWidth={1.6} aria-hidden /><span>{rulesNote}</span></p>
      </header>

      {showValidation ? (
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
            <span className={ui.label}>Paste YDK</span>
            <textarea
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              rows={6}
              className={cx(ui.input, ui.textarea)}
              spellCheck={false}
              placeholder={"#main\n46986414\n#extra\n!side"}
            />
          </label>
          <SheetButton size="sm" onClick={onPasteApply}>Load paste</SheetButton>
        </div>
      </div>

      <div className={styles.addRow}>
        <label className={styles.addCode}>
          <span className={ui.label}>Add passcode</span>
          <input
            value={addCode}
            onChange={(event) => setAddCode(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPasscode(); } }}
            inputMode="numeric"
            placeholder="e.g. 46986414"
            className={cx(ui.input, styles.compactInput)}
          />
        </label>
        <SheetSelect
          className={styles.addSection}
          label="Section"
          compact
          value={addSection}
          choices={[
            { value: "main", label: "Main" },
            { value: "extra", label: "Extra" },
            ...(sideAllowed ? [{ value: "side" as const, label: "Side" }] : []),
          ]}
          onChange={setAddSection}
        />
        <SheetButton size="sm" className={styles.addBtn} onClick={addPasscode}>
          <Plus size={15} strokeWidth={1.7} aria-hidden />Add
        </SheetButton>
      </div>

      {parseError ? <p role="alert" className={ui.alert}>{parseError}</p> : null}

      <Section title="Main" section="main" codes={main} problems={problems} target={mainTarget} onRemove={(index) => {
        setMain((cards) => cards.filter((_, i) => i !== index));
        setEdited(true);
      }} />
      <Section title="Extra" section="extra" codes={extra} problems={problems} target={extraTarget} onRemove={(index) => {
        setExtra((cards) => cards.filter((_, i) => i !== index));
        setEdited(true);
      }} />
      {sideAllowed || side.length > 0 ? (
        <Section title="Side" section="side" codes={side} problems={problems} target={sideTarget} onRemove={(index) => {
          setSide((cards) => cards.filter((_, i) => i !== index));
          setEdited(true);
        }} />
      ) : null}

      {mode === "domain" ? (
        <div className={styles.master}>
          <label>
            <span className={ui.label}>Deck Master passcode</span>
            <input
              value={deckMaster}
              onChange={(event) => {
                setDeckMaster(event.target.value);
                setEdited(true);
                setParseError(null);
              }}
              inputMode="numeric"
              aria-invalid={masterProblem ? true : undefined}
              aria-describedby={masterProblem ? "deck-master-problem" : undefined}
              className={cx(ui.input, styles.masterInput)}
            />
          </label>
          {masterProblem ? (
            <p id="deck-master-problem" className={ui.alert}>
              {masterProblem.messages.join(" ")}
            </p>
          ) : null}
          <p className={ui.hint}>
            Enter your chosen monster&apos;s card passcode. Keep it separate from Main and Extra.
            {settings.validateDeck ? " A Domain Toolbox YDK can supply it as the sole Side card." : " In Custom Domain, the imported Side section is kept as a Side Deck."}{" "}
            Main Deck Pendulum Masters may also be activated as Pendulum scales.
          </p>
          {extra.length > 0 ? (
            <div className={styles.useRow}>
              {Array.from(new Set(extra)).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={styles.use}
                  onClick={() => {
                    setDeckMaster(String(code));
                    setEdited(true);
                    setParseError(null);
                  }}
                >
                  Use {code}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
