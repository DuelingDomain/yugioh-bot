"use client";

/**
 * The status layer of a board card (owner-approved demo, 2026-10-23): protection glyphs in a rail on the card's inner edge
 * (edge rail), counters as a stack of coins with a total (crest + stack) and the negated chip. The layer never takes
 * a click (the card below it does), sits clear of the name, the ATK / DEF plate and the other corner marks, and
 * keeps every glyph upright for the viewer on a turned seat field (`--seat-turn`, like the plate). The full list with the
 * engine text is in the card inspector; the zone's accessible name carries it for screen readers.
 */
import type { CSSProperties } from "react";
import {
  countText,
  type CardStatusModel,
  type CounterBadge,
  type StatusKind,
} from "./card-status-model";
import styles from "./card-status.module.css";

const SHIELD = "M12 1.5l9 3.5v6.5c0 5.5-3.8 9.5-9 11.5-5.2-2-9-6-9-11.5V5z";

function Letter({ ch }: { ch: string }) {
  return <text className={styles.letter} x="12" y="16.2" textAnchor="middle" fontSize="11.5" fontWeight="800" fontFamily="Arial, sans-serif">{ch}</text>;
}

/** The glyph of one status kind in a 24 x 24 box. The colour comes from `currentColor`. */
export function StatusGlyph({ kind, label = false }: { kind: StatusKind; label?: boolean }) {
  const common = { viewBox: "0 0 24 24", className: styles.glyph, focusable: false } as const;
  if (kind === "neg") {
    // The stable hook for tests and screen readers (it replaces the old centre disc on the board).
    return (
      <svg {...common} data-kind="neg" {...(label ? { role: "img", "aria-label": "Effects negated", "data-negation-mark": "" } : { "aria-hidden": true })}>
        <circle className={styles.negDisc} cx="12" cy="12" r="9.5" />
        <path className={styles.negSlash} d="M5.8 18.2L18.2 5.8" />
      </svg>
    );
  }
  return (
    <svg {...common} data-kind={kind} aria-hidden="true">
      <path className={styles.shield} d={SHIELD} />
      {kind === "imM" ? <Letter ch="M" /> : null}
      {kind === "imS" ? <Letter ch="S" /> : null}
      {kind === "imT" ? <Letter ch="T" /> : null}
      {kind === "imAll" ? (
        <>
          <circle className={styles.mark} cx="12" cy="11.5" r="4.2" />
          <circle className={styles.markFill} cx="12" cy="11.5" r="1.4" />
        </>
      ) : null}
      {kind === "noBD" ? <path className={styles.mark} d="M8 8l8 8M16 8l-8 8" /> : null}
      {kind === "noED" ? <path className={styles.markFill} d="M13.5 5.5L8 12.5h3.6l-1 6 5.4-7.4h-3.6z" /> : null}
      {kind === "noTgt" ? (
        <>
          <circle className={styles.mark} cx="12" cy="11.5" r="3.8" />
          <path className={styles.mark} d="M12 5v2.5M12 15.5V18M5.5 11.5H8M16 11.5h2.5" />
        </>
      ) : null}
      {kind === "noAtk" ? <path className={styles.mark} d="M12 5.5v9M9 9h6M12 14.5v3" /> : null}
      {kind === "info" ? (
        <>
          <circle className={styles.markFill} cx="12" cy="8" r="1.3" />
          <path className={styles.mark} d="M12 11v6" />
        </>
      ) : null}
    </svg>
  );
}

/** A counter coin: the glyph of its type (or the card initials) in the family colour. */
export function CounterCoin({ badge, className }: { badge: CounterBadge; className?: string }) {
  return (
    <span className={`${styles.coin} ${className ?? ""}`} style={{ "--c": badge.color } as CSSProperties} data-counter-type={badge.type} data-family={badge.family}>
      {badge.initials ? (
        <span className={styles.initials}>{badge.initials}</span>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: badge.svg }} />
      )}
    </span>
  );
}

/** Rail slots by container height: the glyphs that do not fit fold into one "+N" chip (so the rail never reaches the ATK / DEF plate). */
const TIERS = [2, 3, 4] as const;

export function CardStatusLayer({ model, flip, defense }: { model: CardStatusModel; flip?: boolean; defense?: boolean }) {
  const { rail, counters, total } = model;
  if (rail.length === 0 && counters.length === 0) return null;
  const count = rail.length;
  // For a tier of `cap` slots, a rail longer than `cap` shows cap - 1 glyphs and a "+N" chip.
  const hiddenAt = (index: number) => Object.fromEntries(TIERS.filter((cap) => count > cap && index >= cap - 1).map((cap) => [`data-h${cap}`, ""]));
  return (
    <span className={styles.layer} data-card-status data-side={flip ? "opp" : "you"} data-defense={defense ? "true" : undefined}>
      <span className={styles.inner}>
        {rail.length > 0 ? (
          <span className={styles.rail} data-status-rail>
            {rail.map((kind, index) => (
              <span key={kind} className={styles.chip} data-status-kind={kind} {...hiddenAt(index)}>
                <StatusGlyph kind={kind} label={kind === "neg"} />
              </span>
            ))}
            {TIERS.filter((cap) => count > cap).map((cap) => (
              <span key={cap} className={styles.more} {...{ [`data-m${cap}`]: "" }} data-status-more>+{count - cap + 1}</span>
            ))}
          </span>
        ) : null}
        {counters.length > 0 ? (
          <span className={styles.stack} data-status-counters={total}>
            {counters.slice(0, 3).map((badge) => <CounterCoin key={badge.type} badge={badge} />)}
            <b className={styles.total}>{countText(total)}{counters.length > 3 ? "+" : ""}</b>
          </span>
        ) : null}
      </span>
    </span>
  );
}
