"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { Ban } from "lucide-react";
import type { DeckCardInfo, DuelDeckCardRef } from "@yugidraft/shared/duels";
import {
  MAX_GENESYS_POINT_CAP,
  distinctRefs,
  genesysCardLine,
  genesysMark,
  genesysMarkText,
  genesysTotalText,
  genesysVerdict,
  parsePointCap,
  type GenesysSummary,
} from "./genesys";
import styles from "./genesys.module.css";

type MarkCard = Pick<DeckCardInfo, "type" | "genesysPoints">;

/**
 * The points on a card tile (bottom left, clear of the name and the other marks): a bold number with "pts", a ban sign
 * for Link and Pendulum, or "?" when the points are not known. `row` is the strip on a list thumbnail, `inline` a chip
 * in a search result row, and `lift` raises the chip above a strip across the foot of the card. `zero` also shows a
 * 0-point card (the Deck Master slot).
 */
export function GenesysBadge({ card, variant = "tile", lift, zero }: { card: MarkCard | null | undefined; variant?: "tile" | "browse" | "row" | "inline"; lift?: boolean; zero?: boolean }) {
  // `zero` is for the Deck Master slot: a 0-point Master still shows "0 pts", so it is clear it was counted.
  const mark = genesysMark(card) ?? (zero && card ? ({ kind: "points", points: 0 } as const) : null);
  if (!mark) return null;
  return (
    <span className={styles.badge} data-k={mark.kind} data-v={variant === "tile" ? undefined : variant} data-lift={lift && (variant === "tile" || variant === "browse") ? "" : undefined} data-w={mark.kind === "points" && mark.points >= 100 ? "" : undefined} title={genesysMarkText(mark)}>
      {mark.kind === "forbidden" ? <Ban aria-hidden /> : <><b>{mark.kind === "unknown" ? "?" : mark.points}</b><small aria-hidden>pts</small></>}
    </span>
  );
}

/** The card panel line: "3 Genesys points", "Not allowed in Genesys" or "Genesys points unknown". */
export function GenesysCardLine({ card }: { card: MarkCard }) {
  const mark = genesysMark(card);
  return (
    <p className={styles.cardLine} data-k={mark?.kind ?? "none"}>
      {mark?.kind === "forbidden" ? <Ban aria-hidden /> : null}
      {mark?.kind === "points" ? <><b>{mark.points}</b> Genesys {mark.points === 1 ? "point" : "points"}</> : genesysCardLine(card)}
    </p>
  );
}

/**
 * The total against the cap. `onCapChange` makes the cap a field; without it the cap is plain text.
 * A cap that is not a whole number from 0 to 1000 is not taken, and the field returns to the cap on blur.
 */
export function GenesysMeter({
  summary,
  onCapChange,
  disabled,
  wide,
}: {
  summary: GenesysSummary;
  onCapChange?: (cap: number) => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(summary.cap));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(String(summary.cap)); }, [summary.cap, editing]);
  const invalid = editing && parsePointCap(text) == null;
  const fill = summary.cap > 0 ? Math.min(1, summary.known / summary.cap) : summary.known > 0 ? 1 : 0;
  const total = genesysTotalText(summary);
  const verdict = genesysVerdict(summary);
  return (
    <div className={styles.meter} data-s={summary.state} data-wide={wide ? "" : undefined} role="group" aria-label="Genesys points">
      <span className={styles.label}>Points</span>
      <span
        className={styles.bar}
        role="meter"
        aria-label="Genesys points used"
        aria-valuemin={0}
        aria-valuemax={summary.cap}
        aria-valuenow={Math.min(summary.known, summary.cap)}
        aria-valuetext={`${total} of ${summary.cap} points. ${verdict.flag}.`}
      >
        <span className={styles.fill} style={{ "--fill": `${Math.round(fill * 100)}%` } as CSSProperties} />
      </span>
      <span className={styles.value}>
        <b>{total}</b>
        <span aria-hidden="true">/</span>
        {onCapChange ? (
          <>
            <label htmlFor={id} className="sr">Point cap</label>
            <input
              id={id}
              className={styles.cap}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_GENESYS_POINT_CAP}
              step={1}
              value={text}
              disabled={disabled}
              aria-invalid={invalid || undefined}
              onFocus={() => setEditing(true)}
              onChange={(event) => {
                setText(event.target.value);
                const cap = parsePointCap(event.target.value);
                if (cap != null) onCapChange(cap);
              }}
              onBlur={() => { setEditing(false); setText(String(summary.cap)); }}
            />
          </>
        ) : (
          <span>{summary.cap}</span>
        )}
        <small>pts</small>
      </span>
    </div>
  );
}

/** The deck check part for Genesys: what is not allowed, the cap, and cards with no points. Cards open on click. */
export function GenesysCheck({
  summary,
  onCard,
}: {
  summary: GenesysSummary;
  onCard?: (ref: DuelDeckCardRef) => void;
}) {
  const forbidden = distinctRefs(summary.forbidden);
  const unknown = distinctRefs(summary.unknownCards);
  const show = (items: ReturnType<typeof distinctRefs>, why: string) => (
    <ul className={styles.list}>
      {items.map(({ ref, count }) => (
        <li key={ref.code}>
          <button type="button" disabled={!onCard} onClick={() => onCard?.(ref)}>
            <span className={styles.name}>{ref.name ?? `Passcode ${ref.code}`}{count > 1 ? ` ×${count}` : ""}</span>
            <span className={styles.why}>{why}</span>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <section className={styles.check} aria-label="Genesys">
      <h3>Genesys</h3>
      <p className={styles.line} data-tone={summary.over > 0 ? "bad" : undefined}>
        {summary.total != null ? `${summary.total}` : `At least ${summary.known}`} of {summary.cap} points used
        {summary.over > 0 ? `. ${summary.over} over the cap.` : "."}
      </p>
      {forbidden.length > 0 ? show(forbidden, "Not allowed in Genesys") : null}
      {unknown.length > 0 ? (
        <>
          <p className={styles.line} data-tone="warn">Points are unknown for these cards. The total is not final.</p>
          {show(unknown, "Points unknown")}
        </>
      ) : null}
      {summary.pendingCount > 0 ? <p className={styles.line} data-tone="warn">Counting points for {summary.pendingCount} {summary.pendingCount === 1 ? "card" : "cards"}…</p> : null}
    </section>
  );
}
