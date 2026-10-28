"use client";

import { ArrowLeft } from "lucide-react";
import { DeckSegmented } from "@/components/decks/controls";
import styles from "./hook-drill.module.css";

const SCOPES = [
  { value: "outside" as const, label: "Outside the archetype" },
  { value: "all" as const, label: "All cards" },
];

/**
 * The top of a drill-down from a "How it plays" row: where you are ("Fiendsmith › LIGHT Fiend monsters"),
 * a Back button, and a switch between the cards outside the archetype and all cards.
 */
export function HookDrill({
  archetype,
  title,
  members,
  onMembers,
  onBack,
}: {
  archetype: string;
  /** What the list shows: the kind of card, or the hook's label. */
  title: string;
  /** True when the archetype's own cards are in the list. */
  members: boolean;
  onMembers: (members: boolean) => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.drill} data-testid="hook-drill">
      <div className={styles.trail}>
        <button type="button" className={styles.back} aria-label={`Back to ${archetype}`} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />Back
        </button>
        <nav aria-label="Where you are" className={styles.crumbs}>
          <ol>
            <li>{archetype}</li>
            <li aria-current="page" title={title}>{title}</li>
          </ol>
        </nav>
      </div>
      <DeckSegmented hideLabel label="Which cards" value={members ? "all" : "outside"} choices={SCOPES} onChange={(next) => onMembers(next === "all")} />
    </div>
  );
}
