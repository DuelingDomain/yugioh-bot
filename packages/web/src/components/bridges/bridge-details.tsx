"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { CardArt } from "@/components/decks/card-art";
import { LimitBadge } from "@/components/decks/limit-badge";
import drillStyles from "@/components/effect-search/hook-drill.module.css";
import tileStyles from "@/components/decks/suggestions-panel.module.css";
import { cn } from "@/lib/utils";
import { GradeBadge, ProsCons, ReportBridge, Warnings, directionText, type CardPropsFor } from "./bridge-card";
import { roleFor } from "./bridges-model";
import { useBridgeCards } from "./use-bridges";
import type { ShownBridge } from "./bridges-api";
import styles from "./bridges.module.css";

/** The top of a bridge's details: where you are ("Odion › Argostars") and a Back button, like the hook drill-down. */
function BridgeDrill({ source, target, onBack }: { source: string; target: string; onBack: () => void }) {
  // The details open with Back focused, so a keyboard user can leave as quickly as they came in.
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), []);
  return (
    <div className={drillStyles.drill} data-testid="bridge-drill">
      <div className={drillStyles.trail}>
        <button ref={backRef} type="button" className={drillStyles.back} aria-label={`Back to bridges from ${source}`} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />Back
        </button>
        <nav aria-label="Where you are" className={drillStyles.crumbs}>
          <ol>
            <li>{source}</li>
            <li aria-current="page" title={target}>{target}</li>
          </ol>
        </nav>
      </div>
    </div>
  );
}

/**
 * One bridge in full: the line in order, the good and bad points, the lock note, the warnings, and every bridge
 * card as a tile that works like a tile in Suggestions.
 */
export function BridgeDetails({ bridge, mode, onCatalog, cardProps, deckCount, limit, genesys, onBack }: {
  bridge: ShownBridge;
  mode: DuelMode;
  onCatalog: (cards: DeckCardInfo[]) => void;
  cardProps: CardPropsFor;
  deckCount: (card: DeckCardInfo) => number;
  limit: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  genesys: boolean;
  onBack: () => void;
}) {
  const cards = useBridgeCards(bridge.cards, mode, onCatalog);
  return (
    <div className={styles.details} data-testid="bridge-details">
      <BridgeDrill source={bridge.source} target={bridge.target} onBack={onBack} />
      <div className={styles.detailHead}>
        <GradeBadge bridge={bridge} />
        <span className={styles.way} data-way={bridge.two_way ? "two" : "one"}>{directionText(bridge)}</span>
        <p className={styles.wayNote}>{bridge.two_way ? `${bridge.target} also leads back to ${bridge.source}.` : `${bridge.source} leads to ${bridge.target}. It does not lead back.`}</p>
      </div>

      <section aria-labelledby={`line-${bridge.evidence_hash}`}>
        <h4 id={`line-${bridge.evidence_hash}`} className={styles.subTitle}>The line</h4>
        <ol className={styles.line} data-testid="bridge-line">
          {bridge.review.line.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}
        </ol>
      </section>

      <ProsCons bridge={bridge} />
      {bridge.review.lock_note ? <p className={styles.lockNote}><strong>Lock.</strong> {bridge.review.lock_note}</p> : null}
      <Warnings bridge={bridge} genesys={genesys} />

      <section aria-labelledby={`cards-${bridge.evidence_hash}`}>
        <h4 id={`cards-${bridge.evidence_hash}`} className={styles.subTitle}>Bridge cards</h4>
        <ul className={tileStyles.grid} data-testid="bridge-cards">
          {bridge.cards.map((code) => {
            const card = cards.get(code);
            const why = roleFor(bridge, code);
            if (!card) return <li key={code} className={tileStyles.cell}><span className={cn(tileStyles.card, styles.plainTile)}><span className={tileStyles.art}><CardArt code={code} name="" /></span></span></li>;
            const count = deckCount(card);
            return (
              <li key={code} className={tileStyles.cell}>
                <button type="button" className={tileStyles.card} aria-label={`${card.name}${count ? `, ${count} in deck` : ""}. ${why}`} data-un={card.unavailableReason ? "" : undefined} {...cardProps(card)} title={`${card.name}: ${why}`}>
                  <span className={tileStyles.art}>
                    <CardArt code={card.code} name={card.name} />
                    <LimitBadge limit={limit(card)} />
                  </span>
                  <span className={tileStyles.text}>
                    <span className={tileStyles.nameLine}>
                      <strong className={tileStyles.name}>{card.name}</strong>
                      {count > 0 ? <span className={cn("num", tileStyles.have)}>×{count}</span> : null}
                    </span>
                    <span className={tileStyles.why}>{why}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <ReportBridge bridge={bridge} />
    </div>
  );
}
