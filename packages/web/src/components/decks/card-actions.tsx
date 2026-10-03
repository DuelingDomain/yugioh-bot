"use client";

import { Crown, Minus, Plus, Search } from "lucide-react";
import type { CardArchetype, DeckCardInfo, DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { TYPE_MONSTER } from "@/components/duel/constants";
import { cn } from "@/lib/utils";
import { DeckButton } from "./controls";
import { cardArchetypes } from "./filter-model";
import { limitName } from "./limit-badge";
import { defaultAddSection, type DeckSection } from "./model";
import styles from "./editor.module.css";

const SECTION_LABELS: Record<DeckSection, string> = { main: "Main", extra: "Extra", side: "Side" };

export function CardCopyCount({ copies, limit, poolCopies }: { copies: number; limit: number; poolCopies?: number }) {
  return <p className={styles["de-copies"]}><b className="num">{copies}</b>{" "}of <b className="num">{poolCopies ?? limit}</b>{" "}{poolCopies !== undefined ? "pool copies " : ""}in deck</p>;
}

/** Add, remove and Deck Master controls for the inspected card, under the card text. */
export function CardActions({
  card,
  deck,
  mode,
  copies,
  limit,
  poolCopies,
  banlistName,
  archetypes,
  onAdd,
  onRemove,
  onMaster,
  onArchetype,
  hideSummary = false,
}: {
  card: DeckCardInfo;
  deck: DuelDeck;
  mode: DuelMode;
  /** All copies in the deck with this card's name (alternate artworks included). */
  copies: number;
  limit: 0 | 1 | 2 | 3;
  /** Draft deck mode: copies of this card in the player's pool. They replace the banlist limit. */
  poolCopies?: number;
  banlistName: string | null;
  archetypes: readonly CardArchetype[];
  onAdd: (section: DeckSection) => void;
  onRemove: (section: DeckSection) => void;
  onMaster: () => void;
  onArchetype: (archetype: CardArchetype) => void;
  hideSummary?: boolean;
}) {
  const home = defaultAddSection(card);
  const sections: DeckSection[] = [home, "side"];
  if (home === "main" && deck.extra.includes(card.code)) sections.splice(1, 0, "extra");
  if (home === "extra" && deck.main.includes(card.code)) sections.splice(1, 0, "main");
  const inPool = poolCopies !== undefined;
  const full = inPool ? copies >= poolCopies : copies >= limit;
  const status = inPool ? null : limitName(limit);
  const own = cardArchetypes(card.setcodes, archetypes);
  const isMaster = deck.deckMaster === card.code;
  const canMaster = mode === "domain" && (card.type & TYPE_MONSTER) !== 0;

  return (
    <div className={styles["de-acts-c"]}>
      {hideSummary ? null : <div className={styles.actionsHead}>
        <CardCopyCount copies={copies} limit={limit} poolCopies={poolCopies} />
        {status ? (
          <span className={cn("chip", limit === 0 ? styles.chipBad : "chip-gold")} title={banlistName ? `${status} on ${banlistName}` : status}>
            {status}
          </span>
        ) : null}
      </div>}

      <ul className={styles.steppers}>
        {sections.map((section) => {
          const count = deck[section].filter((code) => code === card.code).length;
          const label = SECTION_LABELS[section];
          return (
            <li key={section} className={styles["de-step"]}>
              <span>{label}</span>
              <button
                type="button"
                className={styles["de-ib"]}
                aria-label={`Remove one ${card.name} from ${label}`}
                disabled={count === 0}
                onClick={() => onRemove(section)}
              >
                <Minus size={15} strokeWidth={1.8} aria-hidden />
              </button>
              <output className="num" aria-label={`${count} in ${label}`}>{count}</output>
              <button
                type="button"
                className={styles["de-ib"]}
                aria-label={`Add one ${card.name} to ${label}`}
                disabled={full || (section !== home && section !== "side")}
                onClick={() => onAdd(section)}
              >
                <Plus size={15} strokeWidth={1.8} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

      {canMaster ? (
        <DeckButton size="sm" kind={isMaster ? "quiet" : "secondary"} block disabled={isMaster} onClick={onMaster}>
          <Crown size={15} strokeWidth={1.6} aria-hidden />
          {isMaster ? "This is your Deck Master" : "Use as Deck Master"}
        </DeckButton>
      ) : null}

      {own.length > 0 ? (
        <div className={styles.archetypes}>
          <p className={styles.actionsLabel}>Archetype</p>
          <ul>
            {own.map((archetype) => (
              <li key={archetype.name}>
                <button
                  type="button"
                  className={cn("chip chip-pen", styles.archetypeChip)}
                  title={`Show all ${archetype.name} cards`}
                  onClick={() => onArchetype(archetype)}
                >
                  <Search size={12} aria-hidden />
                  {archetype.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
