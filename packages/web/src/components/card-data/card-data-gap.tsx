"use client";

import * as React from "react";
import type { CardDataGapCard, CardDataStatus } from "@yugidraft/shared/types";
import { StatusLine, SvButton } from "@/components/sheet";
import { cardImageUrl } from "@/lib/card-image-url";
import {
  absoluteDate,
  type CardDataSetGapStatus,
  filterGap,
  notCheckedSentence,
  recentIdMismatch,
  recentSetsUnknown,
  relativeTime,
  setGapState,
  sortGap,
  sortSets,
} from "@/lib/card-data-status-model";
import { requestImageSlot } from "@/lib/image-queue";
import styles from "./card-data.module.css";

export const GAP_PAGE = 25;
const FILTER_DELAY_MS = 250;

/** The card art loads only when the image queue has a free slot, so a long list stays gentle on the image route. */
function QueuedThumb({ id }: { id: number }) {
  const [src, setSrc] = React.useState<string | null>(null);
  const releaseRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    releaseRef.current = requestImageSlot(() => setSrc(cardImageUrl(id, "small")));
    return () => releaseRef.current?.();
  }, [id]);
  const done = () => releaseRef.current?.();
  if (!src) return <span className={styles.thumb} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.thumb} src={src} alt="" width={32} height={46} onLoad={done} onError={done} />;
}

/** Cards with art, set code and release date, 25 at a time. Scrolls inside its own box. */
export function GapCardTable({ cards, label }: { cards: CardDataGapCard[]; label: string }) {
  const [shown, setShown] = React.useState(GAP_PAGE);
  React.useEffect(() => setShown(GAP_PAGE), [cards]);
  const visible = cards.slice(0, shown);
  return (
    <div className={styles.cardTable}>
      <div className={styles.gapScroll} tabIndex={0} role="region" aria-label={label}>
        <table className={styles.gapTable}>
          <thead>
            <tr>
              <th scope="col" className={styles.thumbCol}><span className="sv-sr">Art</span></th>
              <th scope="col">Name</th><th scope="col">Passcode</th><th scope="col">Set</th><th scope="col">Released</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((card) => (
              <tr key={card.id}>
                <td className={styles.thumbCol}><QueuedThumb id={card.id} /></td>
                <td className={styles.gapName}>{card.name}</td>
                <td className={styles.mono}>{card.id}</td>
                <td className={styles.mono}>{card.setCode ?? "none"}</td>
                <td>{absoluteDate(card.setReleaseDate) ?? "none"}</td>
              </tr>
            ))}
            {visible.length === 0 ? <tr><td colSpan={5} className={styles.mute}>No card matches this filter.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {cards.length > visible.length ? (
        <SvButton variant="ghost" onClick={() => setShown((n) => n + GAP_PAGE)}>
          Show more ({cards.length - visible.length} left)
        </SvButton>
      ) : null}
    </div>
  );
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), FILTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

function SetRow({ set, query, now }: { set: CardDataSetGapStatus; query: string; now: number }) {
  const state = setGapState(set);
  const [expanded, setExpanded] = React.useState(false);
  const cards = React.useMemo(() => filterGap(set.missingCards, query), [set.missingCards, query]);
  const filtering = query.trim() !== "";
  if (filtering && cards.length === 0) return null;
  const open = expanded || filtering;
  const panelId = `cd-set-${set.code ?? set.name.replace(/\W+/g, "-")}`;
  const checked = relativeTime(set.checkedAt, now);
  const verdict =
    state === "unknown" ? "Unknown"
    : state === "missing" ? `${set.missingCount} missing of ${set.total}`
    : `Complete, ${set.total} cards`;
  return (
    <li className={styles.setItem} data-state={state}>
      <button
        type="button"
        className={styles.setButton}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={state !== "missing"}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.setName}>{set.name}</span>
        <span className={styles.mono}>{set.code ?? ""}</span>
        <span className={styles.mute}>{absoluteDate(set.releaseDate) ?? "no date"}</span>
        <span className={styles.setVerdict} data-state={state}>{verdict}</span>
        <span className={styles.mute}>{checked ? `checked ${checked}` : "never checked"}</span>
      </button>
      {open && state === "missing" ? (
        <div id={panelId} className={styles.setPanel}>
          <GapCardTable cards={cards} label={`Cards missing from the engine in ${set.name}`} />
        </div>
      ) : null}
    </li>
  );
}

function MismatchNote({ cards, label }: { cards: CardDataGapCard[]; label: string }) {
  const [open, setOpen] = React.useState(false);
  if (cards.length === 0) return null;
  return (
    <div className={styles.quiet}>
      <p className={styles.rowNote}>
        {cards.length} {cards.length === 1 ? "card has" : "cards have"} the same name in the engine under a different ID (same card, different ID). {label}{" "}
        <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </button>
      </p>
      {open ? (
        <ul className={styles.mismatchList} aria-label="Same card, different ID">
          {cards.map((card) => (
            <li key={card.id}>
              {card.name} <span className={styles.mono}>{card.id}</span>
              {card.setCode ? <span className={styles.mute}> · {card.setCode}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function GapSection({ status, now }: { status: CardDataStatus; now: number }) {
  const { gap } = status;
  const [input, setInput] = React.useState("");
  const query = useDebounced(input);
  const sets = React.useMemo(() => sortSets(gap.recentSets), [gap.recentSets]);
  const mismatch = React.useMemo(() => recentIdMismatch(status), [status]);
  const unknownSets = sets.filter((set) => setGapState(set) === "unknown").length;
  const count = gap.recentSetsMissingFromEngineCount;
  const hasMissing = sets.some((set) => setGapState(set) === "missing");
  const shownSets = sets.filter((set) => !query.trim() || filterGap(set.missingCards, query).length > 0);
  return (
    <section className="set-sec" aria-labelledby="cd-gap">
      <div className="set-intro">
        <h2 id="cd-gap">New TCG cards</h2>
        <p>Cards in TCG sets of the last 12 months that the duel engine does not have yet, set by set, newest first.</p>
      </div>
      <div className={styles.block}>
        <dl className={styles.facts}>
          <div>
            <dt>Not in the engine yet</dt>
            <dd data-bad={(count ?? 0) > 0 ? "true" : undefined}>
              {count === null ? <span className={styles.mute}>unknown</span> : count.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt>Recent sets checked</dt>
            <dd>{(sets.length - unknownSets).toLocaleString("en-US")} of {sets.length.toLocaleString("en-US")}</dd>
          </div>
        </dl>
        {recentSetsUnknown(status) ? (
          <StatusLine tone="neutral">
            {sets.length === 0
              ? "The recent set list is not synced yet, so new cards cannot be compared."
              : `${unknownSets ? notCheckedSentence(unknownSets) : "Some sets not checked yet"}. They are not counted as complete.`}
          </StatusLine>
        ) : null}
        {sets.length > 0 ? (
          <>
            {hasMissing ? (
              <div>
                <label className="label" htmlFor="cd-gap-search">Filter missing cards by name, passcode or set code</label>
                <input
                  id="cd-gap-search"
                  className="input"
                  type="search"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="e.g. Blue-Eyes or RA05"
                />
                <p className={styles.rowNote} role="status">
                  {query.trim() ? `${shownSets.length} of ${sets.length} sets have a match` : ""}
                </p>
              </div>
            ) : null}
            <ul className={styles.setList} aria-label="Recent TCG sets">
              {sets.map((set) => <SetRow key={`${set.code ?? ""}-${set.name}`} set={set} query={query} now={now} />)}
            </ul>
          </>
        ) : null}
        <MismatchNote cards={mismatch} label="This is not counted as missing." />
      </div>
    </section>
  );
}

/** Secondary: catalog rows our site has cached. The catalog fills on demand, so this is not the list of new cards. */
export function CachedCatalogSection({ status }: { status: CardDataStatus }) {
  const { gap } = status;
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const query = useDebounced(input);
  const sorted = React.useMemo(() => sortGap(gap.cachedCatalogMissing), [gap.cachedCatalogMissing]);
  const filtered = React.useMemo(() => filterGap(sorted, query), [sorted, query]);
  const truncated = gap.cachedCatalogMissingCount > gap.cachedCatalogMissing.length;
  return (
    <section className="set-sec" aria-labelledby="cd-cached">
      <div className="set-intro">
        <h2 id="cd-cached">Cards our site has loaded that the engine lacks</h2>
        <p>Catalog cards only: the catalog fills on demand, so this list is incomplete and does not set the status.</p>
      </div>
      <div className={styles.block}>
        <p className={styles.rowNote}>
          {gap.cachedCatalogMissingCount.toLocaleString("en-US")} cached catalog {gap.cachedCatalogMissingCount === 1 ? "card" : "cards"} not in the engine.{" "}
          {gap.cachedCatalogMissingCount > 0 ? (
            <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide the list" : "Show the list"}
            </button>
          ) : null}
        </p>
        {open && gap.cachedCatalogMissing.length > 0 ? (
          <>
            <div>
              <label className="label" htmlFor="cd-cached-search">Filter by name, passcode or set code</label>
              <input id="cd-cached-search" className="input" type="search" value={input} onChange={(e) => setInput(e.target.value)} />
              <p className={styles.rowNote} role="status">
                {query.trim() ? `${filtered.length} of ${gap.cachedCatalogMissing.length} listed cards match` : ""}
                {truncated ? ` The server listed ${gap.cachedCatalogMissing.length} of ${gap.cachedCatalogMissingCount}.` : ""}
              </p>
            </div>
            <GapCardTable cards={filtered} label="Cached catalog cards missing from the engine" />
          </>
        ) : null}
        <MismatchNote cards={gap.cachedCatalogIdMismatch} label="These are cached catalog cards." />
      </div>
    </section>
  );
}
