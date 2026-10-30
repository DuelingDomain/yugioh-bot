"use client";

import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import type { EngineSuggestion } from "@/lib/bridges-api";
import { CodeThumbs, GradeTag, type CardPropsFor } from "./bridge-card";
import { engineGrade, linksText } from "./engine-card";
import { useBridgeCards } from "./use-bridges";
import { useDetectedEngines } from "./use-engines";
import styles from "./engine-fit.module.css";

/** The Suggest tab shows this many engines. */
export const ENGINES_FIT_SHOWN = 3;
/** Each engine shows this many of its cards. */
const THUMBS_SHOWN = 3;

type Props = {
  deck: { main: readonly number[]; extra: readonly number[] };
  deckMaster?: number | null;
  mode: DuelMode;
  genesys: boolean;
  /** Genesys points left, as the editor counts them. */
  genesysRemaining?: number;
  /** The Suggest tab is on screen. A hidden row asks for nothing. */
  active: boolean;
  cardProps: CardPropsFor;
  onCatalog: (cards: DeckCardInfo[]) => void;
  /** A tap on an engine: the Bridges tab opens on it. */
  onOpenEngine: (engine: string) => void;
  /** The empty state opens the Bridges tab: at its Deep search, or in Pick archetypes. */
  onOpenBridges: (to: "deep" | "pick") => void;
  /** The server has no bridges. The row goes away. */
  onDisabled?: () => void;
};

/**
 * "Engines that fit": the best few engines to add next to the engines of the deck, from the stored rows that passed
 * the checks, as short rows (name, grade, the deck engines it links, three cards). The row keeps one height for
 * loading, engines and every empty state, so the card rows below never move when the answer lands.
 */
export function EngineFit({ deck, deckMaster, mode, genesys, genesysRemaining, active, cardProps, onCatalog, onOpenEngine, onOpenBridges, onDisabled }: Props) {
  const empty = deck.main.length === 0;
  const answer = useDetectedEngines({ deck, deckMaster, genesys, empty, enabled: active, genesysRemaining });
  const onDisabledRef = useRef(onDisabled);
  onDisabledRef.current = onDisabled;
  const disabled = answer.error?.status === 404;
  useEffect(() => { if (disabled) onDisabledRef.current?.(); }, [disabled]);
  const top: readonly EngineSuggestion[] = answer.data?.next.slice(0, ENGINES_FIT_SHOWN) ?? [];
  const cards = useBridgeCards([...new Set(top.flatMap((engine) => engine.cards.slice(0, THUMBS_SHOWN)))], mode, onCatalog);
  if (empty || disabled) return null;

  const waiting = answer.data == null && answer.error == null;
  const failed = answer.data == null ? answer.error : null;
  const found = answer.data?.engines.length ?? 0;
  return (
    <section className={styles.row} aria-labelledby="suggest-engines" aria-busy={answer.loading || undefined} data-testid="engines-fit">
      <h3 id="suggest-engines" className={styles.title}>Engines that fit</h3>
      <div className={styles.body}>
        {top.length > 0 ? (
          <ul className={styles.list} aria-label="Engines that fit">
            {top.map((engine) => {
              const word = engineGrade(engine);
              const links = linksText(engine);
              return (
                <li key={engine.engine} className={styles.cell} data-grade={word.toLowerCase()} data-testid="engine-fit-item" data-engine={engine.engine}>
                  <button type="button" className={styles.open} aria-label={`${engine.engine}. ${word}. ${links}. Open in Bridges`} onClick={() => onOpenEngine(engine.engine)}>
                    <span className={styles.text}>
                      <span className={styles.top}>
                        <strong className={styles.name}>{engine.engine}</strong>
                        <GradeTag grade={word.toLowerCase()} text={word} testId="engine-fit-grade" />
                      </span>
                      <span className={styles.links} data-testid="engine-fit-links" title={links}>{links}</span>
                    </span>
                    <ChevronRight size={15} strokeWidth={1.8} aria-hidden className={styles.chevron} />
                  </button>
                  <CodeThumbs codes={engine.cards.slice(0, THUMBS_SHOWN)} label={`${engine.engine} cards`} cards={cards} cardProps={cardProps} limit={THUMBS_SHOWN} />
                </li>
              );
            })}
          </ul>
        ) : waiting ? (
          <div className={styles.skeletons} role="status" aria-label="Looking for engines">{Array.from({ length: ENGINES_FIT_SHOWN }, (_, index) => <span key={index} className={styles.skeleton} aria-hidden />)}</div>
        ) : failed ? (
          <p className={styles.hint} role="alert" data-testid="engines-fit-empty">
            <span>
              {failed.status === 403 ? "Engines need a player in this community."
                : failed.status === 400 ? `${failed.message.replace(/\.$/, "")}.`
                : <>Engines are not available right now. <button type="button" className={styles.link} onClick={answer.retry}>Try again</button></>}
            </span>
          </p>
        ) : found === 0 ? (
          <p className={styles.hint} data-testid="engines-fit-empty">
            <span>No engine found in your deck yet. Add cards from one archetype, or <button type="button" className={styles.link} onClick={() => onOpenBridges("pick")}>pick archetypes in the Bridges tab</button>.</span>
          </p>
        ) : (
          <p className={styles.hint} data-testid="engines-fit-empty">
            <span>No engine has passed our checks for your deck yet. <button type="button" className={styles.link} onClick={() => onOpenBridges("deep")}>Run a Deep search in the Bridges tab</button> to look wider.</span>
          </p>
        )}
      </div>
    </section>
  );
}
