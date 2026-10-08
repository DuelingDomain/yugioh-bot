/**
 * The "Now resolving" panel: what the link being resolved is, what it does, whom it targets and what it did, over a
 * list of every link in the chain. Drawn from a PanelView (chain-narrate.ts), which holds only what this viewer may
 * see; this file adds no data of its own. Three shapes of the same content:
 *  - "wide": the art sits beside the name (a gutter of 230 px or more);
 *  - "narrow": the art sits above the name (150 to 229 px);
 *  - "sheet": the wide shape at the width of a phone, opened from the strip.
 * The strip is the one-line form for phones, tables and a column a prompt would cover; it is a real button.
 */
import { useEffect, useId, useState, type CSSProperties, type Ref } from "react";
import { Check, ChevronDown, ChevronUp, Circle, Play, X } from "lucide-react";
import { cardArtUrl } from "./constants";
import type { HeroView, PanelTone, PanelView, RowView, StripView } from "./chain-narrate";
import { stripLabel } from "./chain-narrate";
import { PriorityChips, type PrioritySlot } from "./priority-chips";
import styles from "./chain-panel.module.css";

export type PanelShape = "wide" | "narrow" | "sheet";

type SeatTones = ReadonlyMap<number, { main: string; ink: string }> | undefined;

function toneVars(tones: SeatTones, seat: number): CSSProperties | undefined {
  const tone = tones?.get(seat);
  return tone ? ({ "--seat-main": tone.main, "--seat-ink": tone.ink } as CSSProperties) : undefined;
}

const artStyle = (code: number | null): CSSProperties | undefined =>
  code != null ? { backgroundImage: `url(${cardArtUrl(code)})` } : undefined;

function StateIcon({ tone }: { tone: PanelTone }) {
  const props = { size: 15, strokeWidth: 2.6, "aria-hidden": true, focusable: false } as const;
  if (tone === "done") return <Check {...props} />;
  if (tone === "neg") return <X {...props} />;
  if (tone === "now") return <Play {...props} fill="currentColor" strokeWidth={0} />;
  return <Circle {...props} size={9} fill="currentColor" strokeWidth={0} />;
}

/** Over these many characters the printed text may be cut at the bottom edge of its box: always (long), or on a short window (mid). See .cardText in the css. */
const LONG_TEXT = 420;
const MID_TEXT = 240;

/**
 * What the link does. The engine's own words for this activation come first (they tell which effect of a card is
 * on the chain); the card's text follows in full, one line per line of the card, with each option as a bullet, so
 * a card that lets its owner pick ("Apply 1 of these effects") shows every choice to every seat.
 */
function EffectBlock({ full }: { full: NonNullable<HeroView["full"]> }) {
  const chars = full.lines.reduce((sum, line) => sum + line.text.length, 0);
  const length = chars > LONG_TEXT ? "long" : chars > MID_TEXT ? "mid" : undefined;
  return (
    <>
      {full.lead ? (
        <p className={styles.effect} data-chain-effect="string">
          <small>Effect</small>
          {full.lead}
        </p>
      ) : null}
      {full.lines.length > 0 ? (
        <div className={styles.cardText} data-chain-effect="text" data-length={length}>
          <small>Card text</small>
          {full.lines.map((line, at) => (
            <p key={at} data-line={line.kind} data-chain-option={line.kind === "option" ? "true" : undefined}>{line.text}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

function Hero({ hero }: { hero: HeroView }) {
  const single = hero.total === 1;
  return (
    <article className={styles.hero} data-tone={hero.tone} data-chain-hero={hero.index} key={`${hero.index}:${hero.tone}`}>
      <div className={styles.eyebrow}>
        <b>{hero.eyebrow}</b>
        <span>{single ? "Effect" : `Link ${hero.index} of ${hero.total}`}</span>
      </div>
      <div className={styles.main}>
        <div className={styles.art} style={artStyle(hero.code)} data-unknown={hero.code == null ? "true" : undefined} data-chain-art={hero.code != null ? "true" : undefined} />
        <div className={styles.who}>
          <h3 className={styles.name}>{hero.name}</h3>
          <p className={styles.sub}><b>{hero.owner}</b>{hero.kind ? ` · ${hero.kind}` : ""}</p>
        </div>
      </div>
      {hero.full ? <EffectBlock full={hero.full} /> : hero.effect ? (
        <p className={styles.effect} data-chain-effect={hero.effect.caption === "Effect" ? "string" : "text"}>
          <small>{hero.effect.caption}</small>
          {hero.effect.text}
        </p>
      ) : null}
      {hero.targets.length > 0 ? (
        <p className={styles.targets} data-chain-hero-targets="true">
          <i aria-hidden="true" />
          {hero.targets.map((target, at) => (
            <span key={at} className={styles.target}>
              {target.name ? <>Targets <b>{target.name}</b><small>{target.place}</small></> : <>Targets <b>{target.place}</b></>}
            </span>
          ))}
        </p>
      ) : null}
      {hero.outcome ? (
        <div className={styles.out} data-tone={hero.outcome.tone} data-chain-outcome="true">
          {hero.outcome.tone === "quiet" ? null : <StateIcon tone={hero.outcome.tone === "neg" ? "neg" : "done"} />}
          <div>
            {hero.outcome.lines.map((line) => <p key={line}>{line}</p>)}
          </div>
        </div>
      ) : hero.waiting ? (
        <p className={styles.wait} data-chain-waiting="true"><i aria-hidden="true" />Resolving…</p>
      ) : null}
    </article>
  );
}

type RowPick = { picked: boolean; onPick: () => void };

function Row({ row, seatTones, expand, pick }: { row: RowView; seatTones: SeatTones; expand?: { open: boolean; controls: string; onToggle: () => void }; pick?: RowPick }) {
  const line = row.result ?? (row.tone === "wait" ? row.effect : null);
  const body = (
    <>
      <b className={styles.rowNum}>{row.index}</b>
      <span className={styles.thumb} style={artStyle(row.code)} />
      <span className={styles.rowText}>
        <span className={styles.rowHead}>
          <span className={styles.rowName}>{row.name}</span>
          <span className={styles.rowOwner} data-chain-row-owner="true">{row.owner}</span>
        </span>
        {line && !row.isHero && !expand?.open ? <span className={styles.rowLine} data-chain-row-line="true">{line}</span> : null}
      </span>
      <span className={styles.rowState}>{expand ? (expand.open ? <ChevronUp size={15} strokeWidth={2.4} aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />) : <StateIcon tone={row.tone} />}</span>
    </>
  );
  if (pick) {
    // The column and the strip's panel: the hero shows one link; a row button shows another one in its place.
    return (
      <button
        type="button"
        className={`${styles.row} ${styles.rowBtn}`}
        data-tone={row.tone}
        data-status={row.status}
        data-negated={row.negated ? "true" : "false"}
        data-focus={row.isHero ? "true" : "false"}
        data-picked={pick.picked ? "true" : "false"}
        data-mine={row.mine ? "true" : "false"}
        data-chain-row={row.index}
        data-toned={seatTones?.has(row.seat) ? "true" : undefined}
        aria-pressed={pick.picked}
        aria-label={`Chain Link ${row.index}, ${row.name}, ${row.owner}. ${pick.picked ? "Showing its details" : "Show details"}`}
        style={toneVars(seatTones, row.seat)}
        onClick={pick.onPick}
      >
        {body}
      </button>
    );
  }
  if (expand) {
    return (
      <button
        type="button"
        className={`${styles.row} ${styles.rowBtn}`}
        data-tone={row.tone}
        data-status={row.status}
        data-negated={row.negated ? "true" : "false"}
        data-focus={row.isHero ? "true" : "false"}
        data-mine={row.mine ? "true" : "false"}
        data-chain-row={row.index}
        data-toned={seatTones?.has(row.seat) ? "true" : undefined}
        aria-expanded={expand.open}
        aria-controls={expand.controls}
        aria-label={`Chain Link ${row.index}, ${row.name}, ${row.owner}. ${expand.open ? "Hide" : "Show"} details`}
        style={toneVars(seatTones, row.seat)}
        onClick={expand.onToggle}
      >
        {body}
      </button>
    );
  }
  return (
    <li
      className={styles.row}
      data-tone={row.tone}
      data-status={row.status}
      data-negated={row.negated ? "true" : "false"}
      data-focus={row.isHero ? "true" : "false"}
      data-mine={row.mine ? "true" : "false"}
      data-chain-row={row.index}
      data-toned={seatTones?.has(row.seat) ? "true" : undefined}
      style={toneVars(seatTones, row.seat)}
    >
      {body}
    </li>
  );
}

export type ChainPanelProps = {
  view: PanelView;
  shape: PanelShape;
  seatTones?: SeatTones;
  priority?: readonly PrioritySlot[];
  mySeat: number | null;
  nameOf: (seat: number) => string;
  panelRef?: Ref<HTMLElement>;
};

/** The panel: header, hero and stack. A chain of one has no header and no stack. */
export function ChainPanel({ view, shape, seatTones, priority, mySeat, nameOf, panelRef }: ChainPanelProps) {
  const many = view.total > 1;
  const accordion = many && shape === "sheet";
  const base = useId();
  // The sheet lists every link; each one opens to its full detail. The link being resolved starts open, and a link that
  // becomes the focus opens too. Nothing closes by itself.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([view.hero.index]));
  useEffect(() => {
    setOpen((prev) => (prev.has(view.hero.index) ? prev : new Set(prev).add(view.hero.index)));
  }, [view.hero.index]);
  const toggle = (index: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (!next.delete(index)) next.add(index);
    return next;
  });
  // The column shows one link in the hero. A row button picks another one for it; the hero follows the live link again when it changes.
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => { setPicked(null); }, [view.hero.index]);
  const pickedAt = picked == null ? -1 : view.rows.findIndex((row) => row.index === picked);
  const hero = pickedAt >= 0 && view.details[pickedAt] ? view.details[pickedAt] : view.hero;
  return (
    <section ref={panelRef} className={styles.cr} data-shape={shape} data-chain-panel="true" data-priority={priority?.length ? "true" : undefined}>
      {many ? (
        <header className={styles.head}>
          <span>Chain</span>
          <small>{view.total} links</small>
          <span className={styles.pips} aria-hidden="true">
            {view.pips.map((tone, at) => <i key={at} data-tone={tone} />)}
          </span>
        </header>
      ) : null}
      {priority && priority.length > 0 ? (
        <div className={styles.prioRow}>
          <PriorityChips order={priority} mySeat={mySeat} nameOf={nameOf} seatTones={seatTones} compact />
        </div>
      ) : null}
      {accordion ? (
        <ol className={styles.stack} data-accordion="true">
          {view.rows.map((row, at) => {
            const isOpen = open.has(row.index);
            const id = `${base}-${row.index}`;
            return (
              <li key={row.index} className={styles.item} data-open={isOpen ? "true" : "false"}>
                <Row row={row} seatTones={seatTones} expand={{ open: isOpen, controls: id, onToggle: () => toggle(row.index) }} />
                <div id={id} className={styles.detail} hidden={!isOpen}>{isOpen ? <Hero hero={view.details[at]} /> : null}</div>
              </li>
            );
          })}
        </ol>
      ) : (
        <>
          <Hero hero={hero} />
          {many ? (
            <ol className={styles.stack}>
              {view.rows.map((row) => (
                <li key={row.index} className={styles.item}>
                  <Row row={row} seatTones={seatTones} pick={{ picked: pickedAt >= 0 && row.index === picked, onPick: () => setPicked((now) => (now === row.index ? null : row.index)) }} />
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </section>
  );
}

export type ChainStripProps = {
  view: StripView;
  open: boolean;
  controls: string;
  onToggle: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
};

/** The one-line form. A real button: the only part of the chain layer that takes a tap. */
export function ChainStrip({ view, open, controls, onToggle, buttonRef }: ChainStripProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.strip}
      data-tone={view.tone}
      data-chain-strip="true"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={stripLabel(view)}
      onClick={onToggle}
    >
      <span className={styles.stripNum} aria-hidden="true">{view.index}{view.total > 1 ? <small>/{view.total}</small> : null}</span>
      <span className={styles.stripText} aria-hidden="true">
        <b>{view.name}</b>
        <span><em>{view.stateLabel}</em>{view.summary ? ` · ${view.summary}` : ""}</span>
      </span>
      {open ? <ChevronUp size={15} strokeWidth={2.4} aria-hidden="true" /> : <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />}
    </button>
  );
}
