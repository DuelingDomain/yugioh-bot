"use client";

import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import type { EngineSuggestion } from "@/lib/bridges-api";
import { CodeThumbs, GradeTag, type CardPropsFor } from "./bridge-card";
import { engineGrade } from "./engine-card";
import { useBridgeCards } from "./use-bridges";
import { useDetectedEngines } from "./use-engines";
import styles from "./engine-fit.module.css";

/** The Suggest tab shows this many engines. */
export const ENGINES_FIT_SHOWN = 3;

type Props = {
  deck: { main: readonly number[]; extra: readonly number[] };
  deckMaster?: number | null;
  mode: DuelMode;
  genesys: boolean;
  /** The Suggest tab is on screen. A hidden row asks for nothing. */
  active: boolean;
  cardProps: CardPropsFor;
  onCatalog: (cards: DeckCardInfo[]) => void;
  /** A tap on an engine: the Bridges tab opens on it. */
  onOpenEngine: (engine: string) => void;
  /** The empty state points to the Bridges tab. */
  onOpenBridges: () => void;
  /** The server has no bridges. The row goes away. */
  onDisabled?: () => void;
};

/**
 * "Engines that fit": the best few engines to add next to the engines of the deck, from the stored rows that passed
 * the checks. That is often nothing yet, so the empty state is a plain hint to the Deep search in the Bridges tab.
 */
export function EngineFit({ deck, deckMaster, mode, genesys, active, cardProps, onCatalog, onOpenEngine, onOpenBridges, onDisabled }: Props) {
  const empty = deck.main.length === 0;
  const answer = useDetectedEngines({ deck, deckMaster, genesys, empty, enabled: active });
  const onDisabledRef = useRef(onDisabled);
  onDisabledRef.current = onDisabled;
  const disabled = answer.error?.status === 404;
  useEffect(() => { if (disabled) onDisabledRef.current?.(); }, [disabled]);
  const top: readonly EngineSuggestion[] = answer.data?.next.slice(0, ENGINES_FIT_SHOWN) ?? [];
  const cards = useBridgeCards([...new Set(top.flatMap((engine) => engine.cards.slice(0, 4)))], mode, onCatalog);
  if (empty || disabled) return null;

  const waiting = answer.data == null && answer.error == null;
  const failed = answer.data == null && answer.error != null;
  const found = answer.data?.engines.length ?? 0;
  return (
    <section className={styles.row} aria-labelledby="suggest-engines" aria-busy={answer.loading || undefined} data-testid="engines-fit">
      <h3 id="suggest-engines" className={styles.title}>Engines that fit</h3>
      {top.length > 0 ? (
        <ul className={styles.grid} aria-label="Engines that fit">
          {top.map((engine) => {
            const word = engineGrade(engine);
            return (
              <li key={engine.engine} className={styles.cell} data-grade={word.toLowerCase()} data-testid="engine-fit-item" data-engine={engine.engine}>
                <button type="button" className={styles.open} aria-label={`${engine.engine}. ${word}, links ${engine.covered} of ${engine.of}. Open in Bridges`} onClick={() => onOpenEngine(engine.engine)}>
                  <strong className={styles.name}>{engine.engine}</strong>
                  <ChevronRight size={15} strokeWidth={1.8} aria-hidden className={styles.chevron} />
                </button>
                <div className={styles.meta}>
                  <GradeTag grade={word.toLowerCase()} text={word} testId="engine-fit-grade" />
                  <span className={styles.links}>Links {engine.covered} of {engine.of}</span>
                </div>
                <CodeThumbs codes={engine.cards} label={`${engine.engine} cards`} cards={cards} cardProps={cardProps} limit={4} />
              </li>
            );
          })}
        </ul>
      ) : waiting ? (
        <div className={styles.skeleton} role="status" aria-label="Looking for engines" />
      ) : (
        <p className={styles.hint} data-testid="engines-fit-empty">
          <span>
            {failed ? "Engines are not available right now. " : found === 0 ? "No engine found in your deck yet. " : "No engine has passed our checks for your deck yet. "}
            <button type="button" className={styles.link} onClick={onOpenBridges}>Run a Deep search in the Bridges tab</button>
            {failed ? " to try again." : " to look wider."}
          </span>
        </p>
      )}
    </section>
  );
}
