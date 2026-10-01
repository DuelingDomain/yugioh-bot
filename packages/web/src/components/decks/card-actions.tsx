"use client";

import { Crown, Minus, Plus, Search } from "lucide-react";
import type { CardArchetype, DeckCardInfo, DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { TYPE_MONSTER } from "@/components/duel/constants";
import { cx, SheetButton } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { cardArchetypes } from "./filter-model";
import { limitName } from "./limit-badge";
import { defaultAddSection, type DeckSection } from "./model";
import styles from "./editor.module.css";

const SECTION_LABELS: Record<DeckSection, string> = { main: "Main", extra: "Extra", side: "Side" };

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
    <div className={styles.actions}>
      <div className={styles.actionsHead}>
        <p className={styles.copies}>
          <span className={ui.num}>{copies}</span> of <span className={ui.num}>{inPool ? poolCopies : limit}</span> {inPool ? "pool copies " : ""}in deck
        </p>
        {status ? (
          <span className={cx(ui.chip, limit === 0 ? styles.chipBad : ui.chipGold)} title={banlistName ? `${status} on ${banlistName}` : status}>
            {status}
          </span>
        ) : null}
      </div>

      <ul className={styles.steppers}>
        {sections.map((section) => {
          const count = deck[section].filter((code) => code === card.code).length;
          const label = SECTION_LABELS[section];
          return (
            <li key={section} className={styles.stepper}>
              <span className={styles.stepLabel}>{label}</span>
              <button
                type="button"
                className={styles.stepButton}
                aria-label={`Remove one ${card.name} from ${label}`}
                disabled={count === 0}
                onClick={() => onRemove(section)}
              >
                <Minus size={15} strokeWidth={1.8} aria-hidden />
              </button>
              <output className={cx(ui.num, styles.stepCount)} aria-label={`${count} in ${label}`}>{count}</output>
              <button
                type="button"
                className={styles.stepButton}
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
        <SheetButton size="sm" kind={isMaster ? "quiet" : "secondary"} block disabled={isMaster} onClick={onMaster}>
          <Crown size={15} strokeWidth={1.6} aria-hidden />
          {isMaster ? "This is your Deck Master" : "Use as Deck Master"}
        </SheetButton>
      ) : null}

      {own.length > 0 ? (
        <div className={styles.archetypes}>
          <p className={styles.actionsLabel}>Archetype</p>
          <ul>
            {own.map((archetype) => (
              <li key={archetype.name}>
                <button
                  type="button"
                  className={cx(ui.chip, styles.archetypeChip)}
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
