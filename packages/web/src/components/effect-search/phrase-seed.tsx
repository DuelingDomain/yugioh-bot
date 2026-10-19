"use client";

import * as React from "react";
import { Check, RotateCcw, TriangleAlert, X } from "lucide-react";
import { cardImageUrl } from "@/lib/card-image-url";
import type { CardSummary } from "@/lib/card-types";
import { EffectCredit } from "./batch-bar";
import { EraNote } from "./era-note";
import { HowItPlays } from "./how-it-plays";
import { EffectApiError, type BatchEntry, type SeedCategory, type SeedPreview, type SeedRole, type SeedRow } from "./effect-api";
import styles from "./effect-search.module.css";

const GROUPS: Array<{ category: SeedCategory; title: string }> = [
  { category: "archetype", title: "Archetype members" },
  { category: "phrase", title: "Match your words" },
  { category: "partner", title: "Work with them" },
  { category: "staple", title: "Staples" },
];

const ROLE_LABEL: Record<SeedRole, string> = {
  searcher: "Searchers",
  extender: "Extenders",
  removal: "Removal",
  hand_trap: "Hand traps",
};

const SIZES = [60, 120, 180, 300] as const;

export interface SeedOutcome {
  added: number;
  copies: number;
}

/**
 * "Seed from a phrase": type a theme, read a preview with a reason for each card, drop the rows you do not
 * want, then confirm. Nothing reaches the cube until the confirm.
 */
export function PhraseSeed({
  preview,
  confirm,
  busy,
  label = "Seed from a phrase",
  eraWarning,
}: {
  preview: (phrase: string, options: { targetCount: number; signal: AbortSignal }) => Promise<SeedPreview>;
  /** Adds the kept rows. Throws an Error with a message fit to show when it is refused. */
  confirm: (entries: BatchEntry[], phrase: string) => Promise<SeedOutcome>;
  busy?: boolean;
  /** The field label. */
  label?: string;
  /** A health note about cards much newer than the rest of the cube, shown with the era note. */
  eraWarning?: string;
}) {
  const inputId = React.useId();
  const sizeId = React.useId();
  const [phrase, setPhrase] = React.useState("");
  const [size, setSize] = React.useState<number>(180);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState<SeedPreview | null>(null);
  const [removed, setRemoved] = React.useState<ReadonlySet<number>>(new Set());
  const [sending, setSending] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const trimmed = phrase.trim();

  const load = async () => {
    if (!trimmed || loading) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const next = await preview(trimmed, { targetCount: size, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      setShown(next);
      setRemoved(new Set());
    } catch (e) {
      if (!mounted.current || (e instanceof DOMException && e.name === "AbortError")) return;
      setShown(null);
      setError(e instanceof EffectApiError && e.disabled ? "Seeding from a phrase is not on for this server." : e instanceof Error ? e.message : "The preview did not work.");
    } finally {
      if (mounted.current && abort.current === controller) setLoading(false);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setShown(null);
    setRemoved(new Set());
    setError(null);
    setLoading(false);
  };

  const cardOf = React.useMemo(() => new Map<number, CardSummary>((shown?.cards ?? []).map((c) => [c.id, c])), [shown]);
  const kept = shown ? shown.rows.filter((r) => !removed.has(r.id)) : [];
  const keptCopies = kept.reduce((n, r) => n + r.copies, 0);

  const send = async () => {
    if (!shown || kept.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const outcome = await confirm(
        kept.map((r) => ({ id: r.id, copies: r.copies, pool: r.pool })),
        shown.phrase,
      );
      if (!mounted.current) return;
      setDone(`Added ${outcome.added} card${outcome.added === 1 ? "" : "s"} (${outcome.copies} cop${outcome.copies === 1 ? "y" : "ies"}) from "${shown.phrase}".`);
      setShown(null);
      setRemoved(new Set());
      setPhrase("");
    } catch (e) {
      if (mounted.current) setError(e instanceof Error && e.message ? e.message : "Could not add the cards. Try again.");
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const toggleRow = (id: number) =>
    setRemoved((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rowsOf = (category: SeedCategory): SeedRow[] => (shown ? shown.rows.filter((r) => r.category === category) : []);

  return (
    <div className={styles.seed} data-testid="phrase-seed">
      <div>
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          className="input"
          value={phrase}
          maxLength={512}
          placeholder="dark magician, floodgates, ritual beasts, ..."
          autoComplete="off"
          data-testid="phrase-input"
          onChange={(event) => setPhrase(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (!event.nativeEvent.isComposing) void load();
          }}
        />
        <p className="hint">Type a theme. You see the cards and why each one is there before anything is added.</p>
      </div>
      <div className={styles.seedActs}>
        <label className={styles.barCopies} htmlFor={sizeId}>
          About
          <select id={sizeId} value={size} onChange={(event) => setSize(Number(event.target.value))} disabled={loading || sending}>
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n} cards
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" disabled={busy || loading || trimmed.length === 0} onClick={() => void load()} data-testid="phrase-preview">
          {loading ? "Reading..." : "Preview cards"}
        </button>
      </div>

      {error && (
        <p className="ce-note warn" role="alert">
          <TriangleAlert className="ic" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {done && (
        <p className="ce-note" role="status">
          <Check className="ic" aria-hidden="true" />
          <span>{done}</span>
        </p>
      )}

      {shown && (
        <div className={styles.seed} data-testid="phrase-preview-panel">
          <div className={styles.seedHead}>
            <p className={styles.seedTitle}>{kept.length === 0 ? "No cards to add" : `${kept.length} cards, ${keptCopies} copies`}</p>
            <p className={styles.seedMeta}>
              {removed.size > 0 ? `${removed.size} removed` : `for "${shown.phrase}"`}
            </p>
          </div>
          {shown.chips && shown.chips.length > 0 && (
            <ul className={styles.chips} aria-label="How the phrase was read">
              {shown.chips.map((chip) => (
                <li key={chip} className={styles.chip}>
                  <span className={styles.chipText}>{chip}</span>
                </li>
              ))}
            </ul>
          )}
          {shown.guide && <HowItPlays guide={shown.guide} testId="seed-how-it-plays" />}
          {shown.era && <EraNote era={shown.era} warning={eraWarning} />}
          {shown.rows.length > 0 && (
            <ul className={styles.quotas} aria-label="Roles in the preview">
              {(Object.keys(ROLE_LABEL) as SeedRole[]).map((role) => (
                <li key={role}>
                  {ROLE_LABEL[role]} <b>{shown.roleQuotas[role].selected}</b>/{shown.roleQuotas[role].target}
                </li>
              ))}
            </ul>
          )}
          {shown.warnings.length > 0 && (
            <ul className={styles.warn} aria-label="Warnings" data-testid="phrase-warnings">
              {shown.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {shown.rows.length > 0 && (
            <div className={styles.seedScroll} tabIndex={0} aria-label="Preview cards">
              {GROUPS.map(({ category, title }) => {
                const rows = rowsOf(category);
                if (rows.length === 0) return null;
                return (
                  <section key={category} aria-label={title}>
                    <h3 className={styles.group}>
                      {title} ({rows.length})
                    </h3>
                    {rows.map((row) => {
                      const card = cardOf.get(row.id);
                      const off = removed.has(row.id);
                      return (
                        <div key={row.id} className={styles.seedRow} data-removed={off ? "" : undefined} data-testid="phrase-row">
                          <span className={styles.thumb}>
                            <img src={cardImageUrl(row.id, "small")} alt="" loading="lazy" />
                          </span>
                          <div className={styles.text}>
                            <p className={styles.n}>{row.name}</p>
                            <p className={styles.k}>
                              {card?.type ?? "Card"}, {row.pool === "extra" ? "Extra" : "Main"}, x{row.copies}
                            </p>
                            <p className={styles.why}>{row.reason}</p>
                          </div>
                          <button
                            type="button"
                            className={styles.seedBtn}
                            aria-label={off ? `Put ${row.name} back` : `Remove ${row.name}`}
                            onClick={() => toggleRow(row.id)}
                          >
                            {off ? <RotateCcw aria-hidden="true" /> : <X aria-hidden="true" />}
                            {off ? "Restore" : "Remove"}
                          </button>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          )}
          <div className={styles.seedActs}>
            <button type="button" className="btn btn-primary" disabled={busy || sending || kept.length === 0} onClick={() => void send()} data-testid="phrase-confirm">
              {sending ? "Adding..." : `Add ${kept.length} card${kept.length === 1 ? "" : "s"} to cube`}
            </button>
            <button type="button" className="btn btn-quiet" disabled={sending} onClick={cancel}>
              Cancel
            </button>
          </div>
          <EffectCredit />
        </div>
      )}
    </div>
  );
}
