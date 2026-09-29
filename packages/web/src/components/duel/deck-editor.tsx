"use client";

import { useEffect, useMemo, useState } from "react";
import type { DuelDeck, DuelDeckValidation, DuelMode, DuelSettings } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { cardArtUrl } from "./constants";
import { applyDomainMaster, parseDeckText, serializeYdk } from "./ydk";
import { validateDuelDeck } from "./api";

type CardProblem = { name?: string; messages: string[] };

function Section({
  title,
  section,
  codes,
  onRemove,
  problems,
}: {
  title: string;
  section: "main" | "extra" | "side";
  codes: number[];
  onRemove: (index: number) => void;
  problems: ReadonlyMap<string, CardProblem>;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-display text-sm text-text-primary">
        {title}{" "}
        <span className="font-body text-xs text-text-muted tabular-nums">{codes.length}</span>
      </h3>
      {codes.length === 0 ? (
        <p className="text-xs text-text-muted">Empty</p>
      ) : (
        <ul className="grid grid-cols-6 gap-1 sm:grid-cols-8">
          {codes.map((code, index) => {
            const problem = problems.get(`${section}:${index}`);
            const reason = problem?.messages.join(" ");
            return (
              <li key={`${title}-${index}-${code}`}>
                <button
                  type="button"
                  className={`group relative aspect-[59/86] w-full overflow-hidden rounded-sm border ${
                    problem ? "border-accent-cta outline-2 outline-accent-cta" : "border-border"
                  }`}
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${problem?.name ?? code} from ${title}${reason ? `. Invalid: ${reason}` : ""}`}
                  title={reason ? `${reason} Click to remove this copy.` : "Click to remove this copy"}
                  data-invalid={problem ? "true" : undefined}
                >
                  <img src={cardArtUrl(code, "small")} alt="" className="h-full w-full object-cover" />
                  {problem ? (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-bg-deep/95 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-cta">
                      Invalid
                    </span>
                  ) : null}
                  <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/55 text-[10px] text-white group-hover:flex group-focus-visible:flex">
                    Remove
                  </span>
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

  return (
    <div className="space-y-4">
      {showValidation ? (
        <div aria-live="polite" role="status">
          {currentValidation?.error ? (
            <div className="space-y-2 rounded-md border border-accent-cta/50 bg-accent-cta/10 p-3 text-sm">
              <p className="font-semibold text-text-primary">Deck could not be checked</p>
              <p className="text-text-secondary">{currentValidation.error}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => {
                setValidation(null);
                setRetry((value) => value + 1);
              }}>Retry validation</Button>
            </div>
          ) : !report ? (
            <p className="text-sm text-text-secondary">Checking deck against this room&apos;s rules…</p>
          ) : report.issues.length > 0 ? (
            <div className="space-y-2 rounded-md border border-accent-cta/50 bg-accent-cta/10 p-3 text-sm">
              <p className="font-semibold text-text-primary">Invalid deck — fix the following before readying</p>
              <ul className="list-disc space-y-1 pl-5 text-text-primary">
                {report.issues.map((issue, index) => (
                  <li key={index}>
                    {issue.message}
                    {issue.cards.length > 1 ? <span className="text-text-secondary"> ({issue.cards.length} highlighted cards)</span> : null}
                  </li>
                ))}
              </ul>
              {problems.size > 0 ? (
                <p className="text-text-secondary">Your imported cards are kept below. Click a red-outlined card to remove that copy.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-accent-success">Deck is valid for this room. You can ready up.</p>
          )}
        </div>
      ) : null}
      <p className="text-sm text-text-secondary">
        {!settings.validateDeck
          ? `Custom deck: format and copy-limit checks are disabled. Card-pool and engine-safety restrictions still apply.${mode === "domain" ? " Enter a separate monster Deck Master passcode." : ""}`
          : mode === "domain"
            ? "Domain: exactly 60 singleton Main Deck cards, up to 15 Extra Deck cards, and one separate Deck Master. The master determines your Domain; there is no separate leader or Domain selection."
            : "Normal: 40–60 Main Deck cards and up to 15 each in Extra and Side. To use a Deck Master, create a Domain table instead."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">YDK file</span>
          <input
            type="file"
            accept=".ydk,text/plain"
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent-primary file:px-3 file:py-2 file:text-white"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">Paste YDK</span>
        <textarea
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          rows={6}
          className="w-full rounded-md border border-border bg-bg-deep px-3 py-2 font-mono text-xs text-text-primary"
          spellCheck={false}
        />
      </label>
      <Button type="button" size="sm" variant="secondary" onClick={onPasteApply}>
        Load paste
      </Button>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">Add passcode</span>
          <input
            value={addCode}
            onChange={(event) => setAddCode(event.target.value)}
            inputMode="numeric"
            className="h-11 w-36 rounded-md border border-border bg-bg-deep px-3 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">Section</span>
          <select
            value={addSection}
            onChange={(event) => setAddSection(event.target.value as "main" | "extra" | "side")}
            className="native-select h-11 rounded-md border border-border bg-bg-deep px-2 text-sm"
          >
            <option value="main">Main</option>
            <option value="extra">Extra</option>
            {sideAllowed ? <option value="side">Side</option> : null}
          </select>
        </label>
        <Button type="button" size="sm" variant="secondary" onClick={addPasscode}>
          Add
        </Button>
      </div>

      <Section title="Main" section="main" codes={main} problems={problems} onRemove={(index) => {
        setMain((cards) => cards.filter((_, i) => i !== index));
        setEdited(true);
      }} />
      <Section title="Extra" section="extra" codes={extra} problems={problems} onRemove={(index) => {
        setExtra((cards) => cards.filter((_, i) => i !== index));
        setEdited(true);
      }} />
      {sideAllowed || side.length > 0 ? (
        <Section title="Side" section="side" codes={side} problems={problems} onRemove={(index) => {
          setSide((cards) => cards.filter((_, i) => i !== index));
          setEdited(true);
        }} />
      ) : null}

      {mode === "domain" ? (
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Deck Master passcode
          </span>
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
            className={`h-11 w-48 rounded-md border bg-bg-deep px-3 text-sm ${
              masterProblem ? "border-accent-cta outline-2 outline-accent-cta" : "border-border"
            }`}
          />
          {masterProblem ? (
            <span id="deck-master-problem" className="mt-1 block text-sm text-accent-cta">
              {masterProblem.messages.join(" ")}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-text-muted">
            Enter your chosen monster&apos;s card passcode. Keep it separate from Main and Extra.
            {settings.validateDeck ? " A Domain Toolbox YDK can supply it as the sole Side card." : " In Custom Domain, the imported Side section is kept as a Side Deck."}
            Main Deck Pendulum Masters may also be activated as Pendulum scales.
          </span>
          {extra.length > 0 ? (
            <span className="mt-2 flex flex-wrap gap-1">
              {Array.from(new Set(extra)).map((code) => (
                <button
                  key={code}
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs hover:border-accent-gold"
                  onClick={() => {
                    setDeckMaster(String(code));
                    setEdited(true);
                    setParseError(null);
                  }}
                >
                  Use {code}
                </button>
              ))}
            </span>
          ) : null}
        </label>
      ) : null}

      {parseError ? <p role="alert" className="text-sm text-accent-cta">{parseError}</p> : null}

      <Button type="button" loading={busy}
        disabled={busy || !canReady} onClick={submit}>
        Ready with this deck
      </Button>
    </div>
  );
}
