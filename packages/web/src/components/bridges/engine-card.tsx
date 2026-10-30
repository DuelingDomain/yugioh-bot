"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import type { EngineSuggestion } from "@/lib/bridges-api";
import { CodeThumbs, GradeTag, Points, type CardPropsFor } from "./bridge-card";
import { useBridgeCards } from "./use-bridges";
import styles from "./bridges.module.css";

/** The grade word of an engine. A niche engine always says Niche, like a niche bridge. */
export const engineGrade = (engine: EngineSuggestion) => (engine.tier === "niche" ? "Niche" : engine.grade);

/** What the deck still needs: cards it holds against copies to add. */
export function needText(engine: EngineSuggestion): string {
  const missing = new Set(engine.missing);
  const held = engine.cards.filter((code) => !missing.has(code)).length;
  const add = engine.missing.length;
  if (add === 0) return engine.cards.length ? "You hold all of its cards." : "";
  return `${held > 0 ? `${held} already in deck. ` : ""}${add} ${add === 1 ? "card" : "cards"} to add.`;
}

/** "Odion ↔ Argostars" for a link that goes back too, "Odion → Argostars" for one that does not. */
function linkEnds(engine: EngineSuggestion, from: string, to: string): string {
  const back = engine.twoWay.includes(from === engine.engine ? to : from);
  return `${from} ${back ? "↔" : "→"} ${to}`;
}

/** One engine that fits next: grade, how many of your engines it links to, the path of each link, the cards, the points. */
export function EngineCard({ engine, cards, cardProps, genesys, onOpen }: {
  engine: EngineSuggestion;
  cards: ReadonlyMap<number, DeckCardInfo>;
  cardProps: CardPropsFor;
  genesys: boolean;
  onOpen?: (engine: EngineSuggestion) => void;
}) {
  const word = engineGrade(engine);
  const need = needText(engine);
  const title = (
    <>
      <strong className={styles.target}>{engine.engine}</strong>
      {onOpen ? <ChevronRight size={15} strokeWidth={1.8} aria-hidden className={styles.chevron} /> : null}
    </>
  );
  return (
    <li className={cn(styles.item, styles.engine)} data-grade={word.toLowerCase()} data-testid="engine-item" data-engine={engine.engine}>
      {onOpen ? (
        <button type="button" className={styles.open} aria-label={`${engine.engine}. ${word}, links ${engine.covered} of ${engine.of}. Open details`} onClick={() => onOpen(engine)}>{title}</button>
      ) : <div className={styles.open}>{title}</div>}
      <div className={styles.meta}>
        <GradeTag grade={word.toLowerCase()} text={word} testId="engine-grade" />
        <span className={styles.way} data-testid="engine-covered">Links {engine.covered} of {engine.of}</span>
        {engine.twoWay.length > 0 ? <span className={styles.way} data-way="two" data-testid="engine-two-way" title={`Also leads back to ${engine.twoWay.join(", ")}`}>Two-way</span> : null}
      </div>
      <ul className={styles.paths} aria-label="How it connects" data-testid="engine-paths">
        {engine.links.map((link) => (
          <li key={`${link.from}>${link.to}:${link.bridge.evidence_hash}`}>
            <span className={styles.pathEnds}>{linkEnds(engine, link.from, link.to)}</span>
            <span className={styles.pathLine}>{link.bridge.review.line.join(" → ")}</span>
          </li>
        ))}
      </ul>
      <div className={styles.engineCards}>
        <CodeThumbs codes={engine.cards} label={`${engine.engine} cards`} cards={cards} cardProps={cardProps} limit={5} />
        {need ? <p className={styles.need} data-testid="engine-need">{need}</p> : null}
      </div>
      <Points pros={engine.pros} cons={engine.cons} clamp={2} />
      {genesys && engine.genesysPoints != null ? (
        <ul className={styles.warnings} aria-label="Warnings"><li><AlertTriangle size={13} strokeWidth={1.8} aria-hidden /><span>Needs about {engine.genesysPoints} Genesys points for its missing cards.</span></li></ul>
      ) : null}
    </li>
  );
}

/** A list of engines. The cards of all engines load together, so the thumbnails fill in at once. */
export function EngineList({ engines, mode, genesys, cardProps, onCatalog, onOpen, label }: {
  engines: readonly EngineSuggestion[];
  mode: DuelMode;
  genesys: boolean;
  cardProps: CardPropsFor;
  onCatalog: (cards: DeckCardInfo[]) => void;
  onOpen?: (engine: EngineSuggestion) => void;
  label: string;
}) {
  const cards = useBridgeCards([...new Set(engines.flatMap((engine) => engine.cards.slice(0, 5)))], mode, onCatalog);
  return (
    <ul className={styles.list} aria-label={label}>
      {engines.map((engine) => <EngineCard key={engine.engine} engine={engine} cards={cards} cardProps={cardProps} genesys={genesys} onOpen={onOpen} />)}
    </ul>
  );
}
