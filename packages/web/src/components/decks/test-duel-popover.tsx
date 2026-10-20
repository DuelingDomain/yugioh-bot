"use client";

import { Swords } from "lucide-react";
import { SvButton, SvCheck } from "@/components/sheet";
import { Popover } from "./import-popover";
import styles from "./editor.module.css";
import type { TestDuelPrefs } from "./test-duel";

/** The "Test duel" button of the deck editor and its two choices. The start button runs the duel; the choices are remembered by the caller. */
export function TestDuelPopover({ open, onOpenChange, disabled, busy, error, prefs, onPrefsChange, onStart }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  prefs: TestDuelPrefs;
  onPrefsChange: (prefs: TestDuelPrefs) => void;
  onStart: () => void;
}) {
  return (
    <Popover
      label="Test duel"
      dialogLabel="Test duel against a bot"
      icon={<Swords className="ic sm" aria-hidden />}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      align="start"
    >
      <p className={styles["de-pop-h"]}>Test duel</p>
      <p className="small">Play this deck against a bot. It is not ranked and keeps no stats. The duel is deleted one day after it ends.</p>
      <SvCheck
        label="Shuffle"
        hint={prefs.shuffle ? "Random opening hand." : "Deck order: the first 5 cards of the Main Deck are your hand."}
        checked={prefs.shuffle}
        disabled={busy}
        onChange={(event) => onPrefsChange({ ...prefs, shuffle: event.target.checked })}
      />
      <SvCheck
        label="Go first"
        hint={prefs.goFirst ? "You take the first turn." : "The bot takes the first turn."}
        checked={prefs.goFirst}
        disabled={busy}
        onChange={(event) => onPrefsChange({ ...prefs, goFirst: event.target.checked })}
      />
      {error ? <p role="alert" className={styles.errorText}>{error}</p> : null}
      <div className={styles["de-pop-a"]}>
        <SvButton variant="quiet" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</SvButton>
        <SvButton variant="primary" data-autofocus aria-busy={busy || undefined} disabled={busy} onClick={onStart}>Start duel</SvButton>
      </div>
    </Popover>
  );
}
