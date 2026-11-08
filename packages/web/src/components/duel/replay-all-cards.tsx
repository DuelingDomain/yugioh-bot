"use client";

/**
 * "Show all cards": the replay of a finished duel with every hand and set card face-up. One pressed button in the same
 * segmented frame as the card-visibility switch. The page only renders it when the server could build that view.
 */
export function ReplayAllCardsToggle({ on, onChange, className }: { on: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <div className={className} data-replay-all-cards>
      <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
        title="Show every player's hand and set cards face-up">
        Show all cards
      </button>
    </div>
  );
}

/** The toggle as the page hands it to a table shell. Absent when the server cannot show all cards (live duel, fork). */
export interface ReplayAllCards {
  on: boolean;
  onChange: (on: boolean) => void;
}
