"use client";

import type { ReactNode } from "react";
import { cx, SheetSegmented, SheetSelect } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import styles from "@/components/duel/creator.module.css";
import { REMOTE_SEAT_CHOICES } from "./create";

type SavedDecks = { data?: { decks: { id: number; name: string }[] }; error?: Error; isLoading: boolean };

/**
 * The Remote table section of the create screen. The duel type and the Genesys controls are the ones of the Online
 * form, so the creator passes them in; the rest (seats, deck, solo test, Set from Deck) is only for Remote.
 */
export function RemoteSetupSection({ formatControls, seats, onSeats, solo, onSolo, deck, onDeck, showSet, onShowSet, decks }: {
  formatControls: ReactNode;
  seats: number; onSeats: (seats: number) => void;
  solo: boolean; onSolo: (solo: boolean) => void;
  deck: string; onDeck: (deck: string) => void;
  showSet: boolean; onShowSet: (show: boolean) => void;
  decks: SavedDecks;
}) {
  const list = decks.data?.decks ?? [];
  const empty = decks.isLoading ? { value: "", label: "Loading decks…", disabled: true }
    : { value: "", label: decks.error ? "Could not load decks · pick in the room" : solo ? "No deck (optional)" : list.length ? "Choose in the room" : "No saved decks · pick in the room" };
  return (
    <section className={styles.section} aria-labelledby="creator-remote" data-testid="remote-setup">
      <div className={styles.side}>
        <h2 id="creator-remote" className={ui.sectionTitle}>Remote table</h2>
        <p className={ui.hint}>Duel type, seats and your deck. The table keeps score.</p>
      </div>
      <div className={styles.fields}>
        {formatControls}
        <SheetSelect label="Your deck" value={deck} choices={[empty, ...list.map((item) => ({ value: String(item.id), label: item.name }))]} onChange={onDeck} />
        <div className={styles.wide}>
          <SheetSegmented label="Seats" value={seats} choices={REMOTE_SEAT_CHOICES} onChange={onSeats} full />
          <p className={cx(ui.hint, styles.below)}>{seats === 2 ? "One against one." : "Free for all."} Others join with the link of the room.</p>
        </div>
        <div className={styles.wide}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={solo} onChange={(event) => onSolo(event.target.checked)} data-testid="create-solo" />
            <span>
              Solo test with bots
              <small>One webcam player with {seats - 1} test {seats === 2 ? "opponent" : "opponents"} you control. The camera stays on this device. No video server needed.</small>
            </span>
          </label>
        </div>
        <div className={styles.wide}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showSet} onChange={(event) => onShowSet(event.target.checked)} data-testid="create-show-set" />
            <span>
              Cards Set from Deck are shown to all
              <small>Also applies to cards searched from Deck to hand. Candidate lists are visible only to the controller.</small>
            </span>
          </label>
        </div>
        {decks.error ? <p className={cx(ui.alert, styles.wide)} role="alert">{decks.error.message}</p> : null}
      </div>
    </section>
  );
}
