"use client";

import { useMemo, useState } from "react";
import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { cardArtUrl } from "./constants";
import { applyDomainMaster, parseDeckText, serializeYdk } from "./ydk";

function Section({
  title,
  codes,
  onRemove,
}: {
  title: string;
  codes: number[];
  onRemove: (index: number) => void;
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
          {codes.map((code, index) => (
            <li key={`${title}-${index}-${code}`}>
              <button
                type="button"
                className="group relative aspect-[59/86] w-full overflow-hidden rounded-sm border border-border"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${code} from ${title}`}
              >
                <img src={cardArtUrl(code, "small")} alt="" className="h-full w-full object-cover" />
                <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/55 text-[10px] text-white group-hover:flex">
                  Remove
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DeckEditor({
  mode,
  initial,
  busy,
  onReady,
}: {
  mode: DuelMode;
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

  const masterCode = useMemo(() => {
    const n = Number(deckMaster);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }, [deckMaster]);

  function applyImported(raw: DuelDeck) {
    const deck = mode === "domain" ? applyDomainMaster(raw, masterCode) : raw;
    setMain(deck.main);
    setExtra(deck.extra);
    setSide(mode === "domain" ? [] : deck.side);
    if (mode === "domain" && deck.deckMaster != null) setDeckMaster(String(deck.deckMaster));
    setPaste(serializeYdk({ ...deck, side: mode === "domain" ? [] : deck.side }));
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
    else if (addSection === "side" && mode !== "domain") setSide((current) => [...current, code]);
    else setMain((current) => [...current, code]);
    setAddCode("");
    setParseError(null);
  }

  function submit() {
    if (mode === "domain" && masterCode == null) {
      setParseError("Domain Format needs an explicit Deck Master passcode.");
      return;
    }
    onReady(
      mode === "domain"
        ? { main, extra, side: [], deckMaster: masterCode }
        : { main, extra, side },
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        {mode === "domain"
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
            {mode === "normal" ? <option value="side">Side</option> : null}
          </select>
        </label>
        <Button type="button" size="sm" variant="secondary" onClick={addPasscode}>
          Add
        </Button>
      </div>

      <Section title="Main" codes={main} onRemove={(index) => setMain((c) => c.filter((_, i) => i !== index))} />
      <Section title="Extra" codes={extra} onRemove={(index) => setExtra((c) => c.filter((_, i) => i !== index))} />
      {mode === "normal" ? (
        <Section title="Side" codes={side} onRemove={(index) => setSide((c) => c.filter((_, i) => i !== index))} />
      ) : null}

      {mode === "domain" ? (
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Deck Master passcode
          </span>
          <input
            value={deckMaster}
            onChange={(event) => setDeckMaster(event.target.value)}
            inputMode="numeric"
            className="h-11 w-48 rounded-md border border-border bg-bg-deep px-3 text-sm"
          />
          <span className="mt-1 block text-xs text-text-muted">
            Enter your chosen monster&apos;s card passcode. Keep it separate from Main and Extra.
            A Domain Toolbox YDK can supply it as the sole Side card.
            Main Deck Pendulum Masters may also be activated as Pendulum scales.
          </span>
          {extra.length > 0 ? (
            <span className="mt-2 flex flex-wrap gap-1">
              {Array.from(new Set(extra)).map((code) => (
                <button
                  key={code}
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs hover:border-accent-gold"
                  onClick={() => setDeckMaster(String(code))}
                >
                  Use {code}
                </button>
              ))}
            </span>
          ) : null}
        </label>
      ) : null}

      {parseError ? <p className="text-sm text-accent-cta">{parseError}</p> : null}

      <Button type="button" loading={busy} disabled={busy || main.length === 0} onClick={submit}>
        Ready with this deck
      </Button>
    </div>
  );
}
