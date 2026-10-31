"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import type { EngineSuggestion } from "@/lib/bridges-api";
import type { ShownBridge } from "./bridges-api";
import { GradeTag, Points, type CardPropsFor } from "./bridge-card";
import { PathThumbs, pathSteps } from "./bridge-path";
import { bridgeCodes } from "./bridges-model";
import { cardsState, useBridgeCards } from "./use-bridges";
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

/** The engines of the set that a suggestion links to, in the order of its links. */
export function linkedEngines(engine: EngineSuggestion): string[] {
  return [...new Set(engine.links.map((link) => (link.from === engine.engine ? link.to : link.from)))];
}

/** "Links Odion + Ashtra", or "Links Odion · 1 of 2" when it does not link the whole set. */
export function linksText(engine: EngineSuggestion): string {
  const linked = linkedEngines(engine);
  const words = `Links ${linked.join(" + ")}`;
  return engine.of > 1 && engine.covered < engine.of ? `${words} · ${engine.covered} of ${engine.of}` : words;
}

/** "Odion ↔ Argostars" for a link that goes back too, "Odion → Argostars" for one that does not. */
function linkEnds(engine: EngineSuggestion, from: string, to: string): string {
  const back = engine.twoWay.includes(from === engine.engine ? to : from);
  return `${from} ${back ? "↔" : "→"} ${to}`;
}

/** One engine that fits next: grade, how many of your engines it links to, the path of each link, the cards, the points. */
export function EngineCard({ engine, mode, cards, cardProps, genesys, onOpen, onOpenLink, lit, fresh }: {
  engine: EngineSuggestion;
  mode: DuelMode;
  cards: ReadonlyMap<number, DeckCardInfo>;
  cardProps: CardPropsFor;
  genesys: boolean;
  onOpen?: (engine: EngineSuggestion) => void;
  /** A link opens the details of its bridge. */
  onOpenLink?: (bridge: ShownBridge) => void;
  /** The Suggest tab asked for this engine: it is marked, and it can take the focus. */
  lit?: boolean;
  /** Only the deep search found it. */
  fresh?: boolean;
}) {
  const word = engineGrade(engine);
  const covered = `Links ${engine.covered} of ${engine.of}`;
  const need = needText(engine);
  const title = (
    <>
      <strong className={styles.target}>{engine.engine}</strong>
      {onOpen ? <ChevronRight size={15} strokeWidth={1.8} aria-hidden className={styles.chevron} /> : null}
    </>
  );
  return (
    <li className={cn(styles.item, styles.engine)} data-grade={word.toLowerCase()} data-testid="engine-item" data-engine={engine.engine} data-lit={lit ? "" : undefined}
      tabIndex={lit ? -1 : undefined}>
      {onOpen ? (
        <button type="button" className={styles.open} aria-label={`${engine.engine}. ${word}, ${linksText(engine).toLowerCase()}. Open details`} onClick={() => onOpen(engine)}>{title}</button>
      ) : <div className={styles.open}>{title}</div>}
      {/* Always in this order (grade, links, two-way, new), so the eye finds each in the same place on every card. */}
      <div className={styles.engineMeta}>
        <GradeTag grade={word.toLowerCase()} text={word} testId="engine-grade" />
        {engine.of > 1 ? <span className={styles.way} data-testid="engine-covered" title={linksText(engine)}>{covered}</span> : null}
        {engine.twoWay.length > 0 ? <span className={styles.way} data-way="two" data-testid="engine-two-way" title={`Also leads back to ${engine.twoWay.join(", ")}`}>Two-way</span> : null}
        {fresh ? <span className={styles.way} data-way="new" data-testid="engine-new" title="The deep search found this engine">New</span> : null}
      </div>
      <ul className={styles.paths} aria-label="How it connects" data-testid="engine-paths">
        {engine.links.map((link) => {
          const ends = linkEnds(engine, link.from, link.to);
          return (
            <li key={`${link.from}>${link.to}:${link.bridge.evidence_hash}`}>
              {onOpenLink ? (
                <button type="button" className={styles.pathButton} data-bridge={link.bridge.evidence_hash} data-testid="engine-link"
                  aria-label={`${ends}. ${link.bridge.grade}. Open details`} onClick={() => onOpenLink(link.bridge)}>
                  <span className={styles.pathEnds}>{ends}<span className={styles.openHint}>Details<ChevronRight size={13} strokeWidth={1.8} aria-hidden className={styles.chevron} /></span></span>
                </button>
              ) : <span className={styles.pathEnds}>{ends}</span>}
              <PathThumbs steps={pathSteps(link.bridge, cards, cardsState(link.bridge.cards, mode))} cardProps={cardProps} label={`${ends}, path of cards`} />
            </li>
          );
        })}
      </ul>
      {need ? <p className={styles.need} data-testid="engine-need">{need}</p> : null}
      <Points pros={engine.pros} cons={engine.cons} clamp={2} />
      {genesys && engine.genesysPoints != null ? (
        <ul className={styles.warnings} aria-label="Warnings"><li><AlertTriangle size={13} strokeWidth={1.8} aria-hidden /><span>Needs about {engine.genesysPoints} Genesys points for its missing cards.</span></li></ul>
      ) : null}
    </li>
  );
}

/** A list of engines. The cards of all engines load together, so the thumbnails fill in at once. */
export function EngineList({ engines, mode, genesys, cardProps, onCatalog, onOpen, onOpenLink, label, lit, fresh }: {
  engines: readonly EngineSuggestion[];
  mode: DuelMode;
  genesys: boolean;
  cardProps: CardPropsFor;
  onCatalog: (cards: DeckCardInfo[]) => void;
  onOpen?: (engine: EngineSuggestion) => void;
  onOpenLink?: (bridge: ShownBridge) => void;
  label: string;
  lit?: string | null;
  /** Engines only the deep search found. */
  fresh?: ReadonlySet<string>;
}) {
  const cards = useBridgeCards(bridgeCodes(engines.flatMap((engine) => engine.links.map((link) => link.bridge))), mode, onCatalog);
  return (
    <ul className={styles.list} aria-label={label}>
      {engines.map((engine) => <EngineCard key={engine.engine} engine={engine} mode={mode} cards={cards} cardProps={cardProps} genesys={genesys} onOpen={onOpen} onOpenLink={onOpenLink} lit={lit === engine.engine} fresh={fresh?.has(engine.engine)} />)}
    </ul>
  );
}
