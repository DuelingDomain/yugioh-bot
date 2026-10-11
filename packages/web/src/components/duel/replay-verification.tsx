import { TriangleAlert } from "lucide-react";
import { SAVED_BOARD_NOTE_COPY, UNCHECKED_BANNER_COPY, type ReplayCheckNote } from "./replay-controller";
import styles from "./replay-verification.module.css";

export const VERIFIED_NOTE_COPY = "Checked with current card data";

/**
 * What the replay tells about its check. An unchecked replay (the owner opened it without the check) gets a compact
 * warning line; a replay that was checked against the saved final board gets a quiet note; an exact replay
 * (or an older server's answer) shows nothing. The saved final board gets a quiet "not a move replay" note instead of the warning. It sits in the info area of each layout, never over the table.
 * `strip` is the one-line form for the free-for-all strip, whose height the board reserves.
 */
export function ReplayVerificationNote({ verification, strip = false }: { verification: ReplayCheckNote; strip?: boolean }) {
  // The saved final board also carries "unverified", but it is not a move replay: no warning about moves, only what it is.
  if (verification === "saved-board") {
    return <p className={styles.verified} data-strip={strip || undefined} data-replay-saved-board>{SAVED_BOARD_NOTE_COPY}</p>;
  }
  if (verification === "unverified") {
    return (
      <p role="status" className={styles.banner} data-strip={strip || undefined} data-replay-unchecked title={UNCHECKED_BANNER_COPY}>
        <TriangleAlert size={14} aria-hidden />
        <span>{UNCHECKED_BANNER_COPY}</span>
      </p>
    );
  }
  if (verification === "verified") {
    return <p className={styles.verified} data-strip={strip || undefined} data-replay-verified>{VERIFIED_NOTE_COPY}</p>;
  }
  return null;
}
