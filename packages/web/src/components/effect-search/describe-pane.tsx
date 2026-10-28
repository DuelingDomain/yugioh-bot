"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { CardSummary } from "@/lib/card-types";
import { useResultNav } from "@/lib/hooks/use-result-nav";
import { EraNote } from "./era-note";
import { IntentHeading, RelaxHints } from "./search-intent";
import { HowItPlays, type HookFind } from "./how-it-plays";
import { HookDrill } from "./hook-drill";
import type { CardEra } from "@yugidraft/shared/cards/effects";
import { effectSearch, hookSearch, EffectApiError, type EffectCard, type EffectSearchResult } from "./effect-api";
import { EffectRows, SelectAllShown, type RowCard } from "./effect-rows";
import { selectAllShown, selectRange, toggle, without, type Batch } from "./selection";
import styles from "./effect-search.module.css";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;
const NO_CARDS: RowCard[] = [];

/** One open "How it plays" row: what it finds, and the cards once they load. */
interface Drill {
  archetype: string;
  index: number;
  find: HookFind;
  members: boolean;
  /** What the list shows: the kind of card, or the row's label. */
  name: string;
  cards: EffectCard[] | null;
  error: boolean;
}

/** The nearest ancestor that scrolls, so Back can put the page back where it was. */
function scroller(node: HTMLElement | null): HTMLElement | null {
  for (let at = node?.parentElement ?? null; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && at.scrollHeight > at.clientHeight) return at;
  }
  return null;
}

interface Answer {
  /** The trimmed text this answer is for. */
  text: string;
  result: EffectSearchResult | null;
  error: EffectApiError | null;
}

/**
 * "Describe" search: the player writes what a card does, sees how it was read (chips they can switch off),
 * and ticks results into a batch. The batch lives in the caller so it survives a change of mode or search.
 */
export function DescribePane({
  batch,
  onBatch,
  held,
  kindLine,
  busy,
  inputLabel = "Describe the cards",
  placeholder = "hand traps that negate, level 4 tuner that searches, ...",
  limit = 30,
  era,
  eraWarning,
  active = true,
}: {
  batch: Batch;
  onBatch: (update: (batch: Batch) => Batch) => void;
  held: (card: CardSummary) => number;
  kindLine: (card: CardSummary) => string;
  busy?: boolean;
  inputLabel?: string;
  placeholder?: string;
  limit?: number;
  /** The years the results lean toward (a cube's era). Shown as a note; it never removes a card. */
  era?: CardEra;
  /** A health note about cards much newer than the rest of the cube. */
  eraWarning?: string;
  active?: boolean;
}) {
  const inputId = React.useId();
  const sortId = React.useId();
  const [sort, setSort] = React.useState<"match" | "newest">("match");
  const [text, setText] = React.useState("");
  const [exact, setExact] = React.useState(false);
  const [omitted, setOmitted] = React.useState<string[]>([]);
  const [fullChips, setFullChips] = React.useState<string[]>([]);
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [keyboard, setKeyboard] = React.useState(false);
  const seq = React.useRef(0);
  const [drill, setDrill] = React.useState<Drill | null>(null);
  const paneRef = React.useRef<HTMLDivElement>(null);
  const cameFrom = React.useRef(0);
  const restore = React.useRef<number | null>(null);
  // The row a drill-down was opened from ("2:is"), so Back can put the keyboard focus on it again.
  const cameButton = React.useRef<string | null>(null);

  // Capture once when Describe opens. Cube edits cannot change the ranking under the pointer.
  const [session, setSession] = React.useState({ era, warning: eraWarning });
  React.useEffect(() => {
    if (active) setSession({ era: era ? { medianYear: Math.round(era.medianYear), spread: Math.round(era.spread) } : undefined, warning: eraWarning });
    // Capture the latest hint only when the user opens this mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const sessionEra = session.era;
  const trimmed = text.trim();
  const eraKey = sessionEra ? `${Math.round(sessionEra.medianYear)}/${Math.round(sessionEra.spread)}` : "";
  const omittedKey = omitted.join("\u0001");

  React.useEffect(() => {
    const mine = ++seq.current;
    if (trimmed.length < MIN_CHARS) {
      setAnswer(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      effectSearch(trimmed, { exact, omittedChips: omitted, limit, sort, era: sort === "newest" ? undefined : sessionEra, signal: controller.signal })
        .then((result) => {
          if (mine !== seq.current) return;
          setAnswer({ text: trimmed, result, error: null });
          // The reading with nothing switched off is the list of chips the player can turn off and on.
          if (omitted.length === 0 && !exact) setFullChips(result.chips ?? []);
        })
        .catch((error: unknown) => {
          if (mine !== seq.current || (error instanceof DOMException && error.name === "AbortError")) return;
          setAnswer({ text: trimmed, result: null, error: error instanceof EffectApiError ? error : new EffectApiError("The description search did not work.", 0) });
        })
        .finally(() => {
          if (mine === seq.current) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `omitted` is read through its key: the array is replaced on every change anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, exact, omittedKey, limit, retry, sort, eraKey]);

  const drillArchetype = drill?.archetype;
  const drillIndex = drill?.index;
  const drillFind = drill?.find;
  const drillMembers = drill?.members;
  React.useEffect(() => {
    if (drillArchetype === undefined || drillIndex === undefined || drillFind === undefined || drillMembers === undefined) return;
    const controller = new AbortController();
    const same = (now: Drill | null) => now != null && now.archetype === drillArchetype && now.index === drillIndex && now.find === drillFind && now.members === drillMembers;
    hookSearch(drillArchetype, drillIndex, drillFind, drillMembers, { limit, sort, era: sort === "newest" ? undefined : sessionEra, signal: controller.signal }).then(
      (found) => setDrill((now) => (same(now) ? { ...now!, cards: found, error: false } : now)),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDrill((now) => (same(now) ? { ...now!, cards: [], error: true } : now));
      },
    );
    return () => controller.abort();
    // The era is read through its key, as in the description search above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillArchetype, drillIndex, drillFind, drillMembers, limit, sort, eraKey]);
  React.useLayoutEffect(() => {
    if (drill || restore.current == null) return;
    const box = scroller(paneRef.current);
    if (box) box.scrollTop = restore.current;
    restore.current = null;
    // The rows are shown again in this commit, so the row that opened the drill-down can take the focus back.
    const row = cameButton.current ? paneRef.current?.querySelector<HTMLElement>(`[data-hook="${cameButton.current}"]`) : null;
    cameButton.current = null;
    row?.focus({ preventScroll: true });
  }, [drill]);

  const searchCards: readonly RowCard[] = answer?.result?.cards ?? NO_CARDS;
  const cards: readonly RowCard[] = drill ? (drill.cards ?? NO_CARDS) : searchCards;
  const selectable = React.useCallback((card: CardSummary) => held(card) === 0, [held]);

  const toggleCard = (card: CardSummary, range: boolean) =>
    onBatch((b) => (range ? selectRange(b, cards, card, selectable) : toggle(b, card, selectable)));

  const nav = useResultNav<RowCard>({
    items: cards,
    query: text,
    resultsFor: drill ? text.trim() : answer?.text ?? "",
    setQuery: (next) => {
      setText(next);
      setOmitted([]);
    },
    onPick: (card) => toggleCard(card, false),
    canPick: (card) => held(card) === 0,
  });

  const ready = trimmed.length >= MIN_CHARS;
  const current = answer && answer.text === trimmed ? answer : null;
  const error = current?.error ?? null;
  const result = current?.result ?? null;
  function openHook(index: number, find: HookFind) {
    const guide = result?.guide;
    const hook = guide?.hooks[index];
    if (!guide || !hook) return;
    cameFrom.current = scroller(paneRef.current)?.scrollTop ?? 0;
    cameButton.current = `${index}:${find}`;
    setDrill({ archetype: guide.archetype, index, find, members: false, name: (find === "is" ? hook.finds?.is?.many : undefined) ?? hook.label, cards: null, error: false });
  }
  function closeHook() {
    restore.current = cameFrom.current;
    setDrill(null);
  }
  const allOff = fullChips.length > 0 && omitted.length >= fullChips.length;

  let empty: string | null = null;
  if (drill) {
    if (drill.error) empty = "Could not find these cards.";
    else if (!drill.cards) empty = "Finding cards...";
    else if (drill.cards.length === 0) empty = drill.members ? "No card fits this." : `No card outside ${drill.archetype} fits this.`;
  } else if (!ready) empty = "Say what the card does. For example: hand traps that negate, or special summon from the graveyard.";
  else if (searching && cards.length === 0) empty = "Searching...";
  else if (result && cards.length === 0) {
    if (exact) empty = "No card text has those words.";
    else if (allOff) empty = "Every part is switched off. Turn one back on.";
    else if (!result.chips) empty = "That did not read as an effect. Try other words, or turn on Exact text to match the written card text.";
    else if (!result.relax?.length) empty = "No cards match all of this. Switch off a part to widen it.";
  }
  const relaxHints = !drill && !exact && !error && !searching && cards.length === 0 ? result?.relax : undefined;

  return (
    <div ref={paneRef} className={styles.pane} data-testid="describe-pane">
      <div>
        <label className="label" htmlFor={inputId}>
          {inputLabel}
        </label>
        <input
          id={inputId}
          className="input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOmitted([]);
            setDrill(null);
          }}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={512}
          data-testid="describe-input"
          {...nav.inputProps}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") setKeyboard(true);
            nav.inputProps.onKeyDown(event);
          }}
        />
      </div>
      <div className={styles.opts}>
        <label className={styles.exact}>
          <input
            type="checkbox"
            checked={exact}
            onChange={(event) => {
              setExact(event.target.checked);
              setOmitted([]);
              setDrill(null);
            }}
          />
          Exact text
        </label>
        <label className={styles.sort} htmlFor={sortId}>
          Sort by
          <select id={sortId} value={sort} onChange={(event) => setSort(event.target.value === "newest" ? "newest" : "match")} data-testid="describe-sort">
            <option value="match">Best match</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </div>
      {drill ? (
        <HookDrill archetype={drill.archetype} title={drill.name} members={drill.members} onBack={closeHook}
          onMembers={(members) => { if (members !== drill.members) setDrill({ ...drill, members, cards: null, error: false }); }} />
      ) : null}
      {!drill && !exact && ready && fullChips.length > 0 && (
        <ul className={styles.chips} aria-label="How the text was read" data-testid="reading-chips">
          {fullChips.map((chip) => {
            const off = omitted.includes(chip);
            return (
              <li key={chip} className={styles.chip} data-off={off ? "" : undefined}>
                <span className={styles.chipText}>{chip}</span>
                <button
                  type="button"
                  className={styles.chipBtn}
                  aria-label={off ? `Turn on ${chip}` : `Switch off ${chip}`}
                  onClick={() => setOmitted((now) => (off ? now.filter((c) => c !== chip) : [...now, chip]))}
                >
                  {off ? <span aria-hidden="true">+</span> : <X aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!drill && !exact && ready && result?.intent ? <IntentHeading intent={result.intent} count={result.total} /> : null}
      {!exact && ready && result?.guide ? <div hidden={drill != null}><HowItPlays guide={result.guide} testId="describe-how-it-plays" onHook={openHook} /></div> : null}
      <div className={styles.eraSlot} data-testid="era-note-space">
        {ready && sort === "match" && sessionEra ? <EraNote era={sessionEra} warning={session.warning} /> : null}
      </div>
      {error ? (
        <div className={styles.err} role="alert">
          <p>{error.message}</p>
          {!error.disabled && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          )}
        </div>
      ) : empty ? (
        <>
          <p className={styles.empty} role="status">
            {empty}
          </p>
          {drill && !drill.members && drill.cards?.length === 0 && !drill.error ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDrill({ ...drill, members: true, cards: null, error: false })}>
              Show all cards
            </button>
          ) : null}
        </>
      ) : null}
      {relaxHints?.length ? <RelaxHints relax={relaxHints} onRemove={(chip) => setOmitted((now) => (now.includes(chip) ? now : [...now, chip]))} /> : null}
      {cards.length > 0 && !error && (
        <div onPointerMove={() => keyboard && setKeyboard(false)}>
          <SelectAllShown
            cards={cards}
            batch={batch}
            selectable={selectable}
            total={drill ? cards.length : result?.total}
            onSelectAll={() => onBatch((b) => selectAllShown(b, cards, selectable))}
            onClear={() => onBatch((b) => without(b, cards.map((c) => c.id)))}
          />
          <EffectRows
            cards={cards}
            batch={batch}
            selectable={selectable}
            held={held}
            kindLine={kindLine}
            nav={nav}
            label={drill ? `Cards for ${drill.name}` : `Cards matching ${trimmed}`}
            stale={nav.stale}
            busy={drill ? drill.cards == null : searching}
            onToggle={toggleCard}
            keyboardActive={keyboard}
          />
        </div>
      )}
    </div>
  );
}
