"use client";

import { useId, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import type { CardAdder } from "@/components/decks/card-adder";
import { cn } from "@/lib/utils";
import type { EngineSuggestion, ShownBridge } from "@/lib/bridges-api";
import { GradeTag, OwnedTag, Points, SynergyTag, synergyText, type CardPropsFor } from "./bridge-card";
import { AddPathCards, PathThumbs, pathSteps, type PathStep } from "./bridge-path";
import { AddEngineCards, EngineCoreGroup, coreCodes, engineAdd } from "./engine-core";
import { bridgeCodes } from "./bridges-model";
import { cardsState, useBridgeCards } from "./use-bridges";
import styles from "./bridges.module.css";

/** The grade word of an engine. A niche engine always says Niche, like a niche bridge. */
const engineGrade = (engine: EngineSuggestion) => (engine.tier === "niche" ? "Niche" : engine.grade);

/** A resource synergy: the source gives the target a resource, but it is no way in. It never counts as a link. */
const isSynergy = (engine: EngineSuggestion) => engine.kind === "synergy";

/** What the deck still needs: cards it holds against copies to add. */
function needText(engine: EngineSuggestion): string {
  const missing = new Set(engine.missing);
  const held = engine.cards.filter((code) => !missing.has(code)).length;
  const add = engine.missing.length;
  if (add === 0) return engine.cards.length ? "You hold all of its cards." : "";
  return `${held > 0 ? `${held} already in deck. ` : ""}${add} ${add === 1 ? "card" : "cards"} to add.`;
}

/** The engines of the set that a suggestion links to, in the order of its links. */
function linkedEngines(engine: EngineSuggestion): string[] {
  return [...new Set(engine.links.map((link) => (link.from === engine.engine ? link.to : link.from)))];
}

/** "Links Odion + Ashtra", or "Links Odion · 1 of 2" when it does not link the whole set. */
function linksText(engine: EngineSuggestion): string {
  const linked = linkedEngines(engine);
  if (isSynergy(engine)) return `Synergy with ${linked.join(" + ")}`;
  const words = `Links ${linked.join(" + ")}`;
  return engine.of > 1 && engine.covered < engine.of ? `${words} · ${engine.covered} of ${engine.of}` : words;
}

/** "Odion ↔ Argostars" for a link that goes back too, "Odion → Argostars" for one that does not. */
function linkEnds(engine: EngineSuggestion, from: string, to: string): string {
  const back = engine.twoWay.includes(from === engine.engine ? to : from);
  return `${from} ${back ? "↔" : "→"} ${to}`;
}

/** What an open engine card adds: the line with each step's sentence, the core, the Add buttons and the reasons. */
function EngineBody({ engine, id, mode, cards, cardProps, genesys, adder, limit, steps }: {
  engine: EngineSuggestion;
  id: string;
  mode: DuelMode;
  cards: ReadonlyMap<number, DeckCardInfo>;
  cardProps: CardPropsFor;
  genesys: boolean;
  adder?: CardAdder;
  limit?: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  /** The steps of each link, in the order of the links. */
  steps: readonly (readonly PathStep[])[];
}) {
  const synergy = isSynergy(engine);
  // With the Add buttons the counts come from the open deck (the core and the buttons); the host's count would disagree.
  const need = adder ? "" : needText(engine);
  // The bridge cards of the engine: the cards of every link's line, once each.
  const line: PathStep[] = [];
  for (const linkSteps of steps) {
    for (const step of linkSteps) {
      if (!line.some((known) => known.name === step.name)) line.push(step);
    }
  }
  // The Add engine note says what the copies cost; then the host's total for the missing cards is not shown too.
  const engineNote = adder && engine.core?.ready ? engineAdd(engine.core, line, cards, mode, adder, genesys).note : undefined;
  return (
    <div id={id} className={styles.engineBody} data-testid="engine-body">
      {synergy && engine.links[0] ? <p className={styles.need} data-testid="engine-synergy-note">{synergyText(engine.links[0].from, engine.links[0].to)}</p> : null}
      <div className={styles.lines} data-testid="engine-steps">
        {engine.links.map((link, index) => (
          <section key={`${link.from}>${link.to}:${link.bridge.evidence_hash}`} aria-label={`${linkEnds(engine, link.from, link.to)}, the line`}>
            <h5 className={styles.subTitle}>{linkEnds(engine, link.from, link.to)}</h5>
            <ol className={styles.lineSteps}>
              {(steps[index] ?? []).map((step, at) => (
                <li key={`${at}-${step.name}`} data-testid="engine-step"><strong>{step.name}</strong>{step.text ? <span> {step.text}</span> : null}</li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      {need ? <p className={styles.need} data-testid="engine-need">{need}</p> : null}
      {engine.core ? <EngineCoreGroup core={engine.core} name={engine.engine} cards={cards} cardProps={cardProps} genesys={genesys} held={adder?.held} limit={limit} heading="h5" /> : null}
      {adder ? (
        <div className={styles.addRow}>
          <AddPathCards steps={line} name={engine.engine} held={adder.held} adder={adder} owned={engine.alreadyInDeck} />
          <AddEngineCards core={engine.core} name={engine.engine} line={line} cards={cards} mode={mode} adder={adder} genesys={genesys} />
        </div>
      ) : null}
      <Points pros={engine.pros} cons={engine.cons} />
      {genesys && engine.genesysPoints != null && !engineNote ? (
        <ul className={styles.warnings} aria-label="Warnings"><li><AlertTriangle size={13} strokeWidth={1.8} aria-hidden /><span>Needs about {engine.genesysPoints} Genesys points for its missing cards.</span></li></ul>
      ) : null}
    </div>
  );
}

/**
 * One engine that fits next. Closed, it is one compact row: the name, the grade, how many of your engines it links to,
 * and the path of each link as small card images. The header opens it in place for the line's sentences, the core, the
 * Add buttons and the reasons. "Details" on a link opens the full page of that bridge, open or closed.
 */
function EngineCard({ engine, mode, cards, cardProps, genesys, adder, limit, onOpenLink, fresh, open, onToggle }: {
  engine: EngineSuggestion;
  mode: DuelMode;
  cards: ReadonlyMap<number, DeckCardInfo>;
  cardProps: CardPropsFor;
  genesys: boolean;
  /** Adds the bridge cards and the engine core that the deck lacks. Not given: no buttons. */
  adder?: CardAdder;
  limit?: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  /** A link opens the details of its bridge. */
  onOpenLink?: (bridge: ShownBridge) => void;
  /** Only the deep search found it. */
  fresh?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const synergy = isSynergy(engine);
  const word = synergy ? "Synergy" : engineGrade(engine);
  const covered = `Links ${engine.covered} of ${engine.of}`;
  const bodyId = useId();
  const steps = engine.links.map((link) => pathSteps(link.bridge, cards, cardsState(link.bridge.cards, mode)));
  return (
    <li className={cn(styles.item, styles.engine)} data-grade={synergy ? undefined : word.toLowerCase()} data-kind={synergy ? "synergy" : undefined} data-testid="engine-item" data-engine={engine.engine} data-owned={engine.alreadyInDeck ? "" : undefined} data-open={open ? "" : undefined}>
      <button type="button" className={styles.engineHead} aria-expanded={open} aria-controls={open ? bodyId : undefined} data-testid="engine-toggle" onClick={onToggle}>
        <span className={styles.open}>
          <strong className={styles.target}>{engine.engine}</strong>
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden className={styles.expandIcon} />
        </span>
        {/* Always in this order (grade, links, two-way, new), so the eye finds each in the same place on every card. */}
        <span className={styles.engineMeta}>
          {synergy ? <SynergyTag testId="engine-synergy" /> : <GradeTag grade={word.toLowerCase()} text={word} testId="engine-grade" />}
          {engine.of > 1 && !synergy ? <span className={styles.way} data-testid="engine-covered" title={linksText(engine)}>{covered}</span> : null}
          {engine.twoWay.length > 0 ? <span className={styles.way} data-way="two" data-testid="engine-two-way" title={`Also leads back to ${engine.twoWay.join(", ")}`}>Two-way</span> : null}
          {engine.alreadyInDeck ? <OwnedTag /> : null}
          {fresh ? <span className={styles.way} data-way="new" data-testid="engine-new" title="The deep search found this engine">New</span> : null}
        </span>
      </button>
      <ul className={styles.paths} aria-label="How it connects" data-testid="engine-paths">
        {engine.links.map((link, index) => {
          const ends = linkEnds(engine, link.from, link.to);
          return (
            <li key={`${link.from}>${link.to}:${link.bridge.evidence_hash}`}>
              {onOpenLink ? (
                <button type="button" className={styles.pathButton} data-bridge={link.bridge.evidence_hash} data-testid="engine-link"
                  aria-label={`${ends}. ${synergy ? "Synergy" : link.bridge.grade}. Open details`} onClick={() => onOpenLink(link.bridge)}>
                  <span className={styles.pathEnds}>{ends}<span className={styles.openHint}>Details<ChevronRight size={13} strokeWidth={1.8} aria-hidden className={styles.chevron} /></span></span>
                </button>
              ) : <span className={styles.pathEnds}>{ends}</span>}
              <PathThumbs steps={steps[index] ?? []} cardProps={cardProps} label={`${ends}, path of cards`} />
            </li>
          );
        })}
      </ul>
      {open ? <EngineBody engine={engine} id={bodyId} mode={mode} cards={cards} cardProps={cardProps} genesys={genesys} adder={adder} limit={limit} steps={steps} /> : null}
    </li>
  );
}

/** A list of engines. The cards of all engines (their links and their core) load together, so the thumbnails fill in at once. */
export function EngineList({ engines, mode, genesys, cardProps, adder, limit, onCatalog, onOpenLink, label, fresh }: {
  engines: readonly EngineSuggestion[];
  mode: DuelMode;
  genesys: boolean;
  cardProps: CardPropsFor;
  adder?: CardAdder;
  limit?: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  onCatalog: (cards: DeckCardInfo[]) => void;
  onOpenLink?: (bridge: ShownBridge) => void;
  label: string;
  /** Engines only the deep search found. */
  fresh?: ReadonlySet<string>;
}) {
  const cards = useBridgeCards([...new Set([...bridgeCodes(engines.flatMap((engine) => engine.links.map((link) => link.bridge))), ...engines.flatMap((engine) => coreCodes(engine.core))])], mode, onCatalog);
  // Real bridges first, then the synergies, whatever order the host sent.
  const ordered = [...engines.filter((engine) => !isSynergy(engine)), ...engines.filter(isSynergy)];
  // One card is open at a time, and nothing is remembered once the list is gone.
  const [openName, setOpenName] = useState<string | null>(null);
  return (
    <ul className={styles.list} aria-label={label}>
      {ordered.map((engine) => <EngineCard key={engine.engine} engine={engine} mode={mode} cards={cards} cardProps={cardProps} genesys={genesys} adder={adder} limit={limit} onOpenLink={onOpenLink} fresh={fresh?.has(engine.engine)} open={openName === engine.engine} onToggle={() => setOpenName((now) => (now === engine.engine ? null : engine.engine))} />)}
    </ul>
  );
}
