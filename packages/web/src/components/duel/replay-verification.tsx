import { TriangleAlert } from "lucide-react";
import { BACK_TO_CHECKED_COPY, SAVED_BOARD_NOTE_COPY, UNCHECKED_BANNER_COPY, withUncheckedParam, type ReplayCheckNote } from "./replay-controller";
import styles from "./replay-verification.module.css";

export const VERIFIED_NOTE_COPY = "Checked with current card data";

/** The address of this page without ?unchecked=1 (the checked view). The banner only exists on the client. */
function checkedHref(): string {
  if (typeof window === "undefined") return "#";
  return withUncheckedParam(`${window.location.pathname}${window.location.search}${window.location.hash}`, false);
}

/**
 * What the replay tells about its check. An unchecked replay (the owner opened it without the check) gets a compact
 * warning line with a way back to the checked view; a replay that was checked against the saved final board gets a quiet
 * note; an exact replay (or an older server's answer) shows nothing. The saved final board gets a quiet "not a move
 * replay" note instead of the warning. It sits in the info area of each layout, never over the table.
 * `strip` is the one-line form for the free-for-all strip, whose height the board reserves: the text is cut with an
 * ellipsis, and the full text is the title of the text only (the banner is a static note, not a live region).
 */
export function ReplayVerificationNote({ verification, strip = false }: { verification: ReplayCheckNote; strip?: boolean }) {
  // The saved final board also carries "unverified", but it is not a move replay: no warning about moves, only what it is.
  if (verification === "saved-board") {
    return <p className={styles.verified} data-strip={strip || undefined} data-replay-saved-board title={strip ? SAVED_BOARD_NOTE_COPY : undefined}>{SAVED_BOARD_NOTE_COPY}</p>;
  }
  if (verification === "unverified") {
    return (
      <p role="note" aria-label="Unchecked replay" className={styles.banner} data-strip={strip || undefined} data-replay-unchecked>
        <TriangleAlert size={14} aria-hidden />
        <span title={strip ? UNCHECKED_BANNER_COPY : undefined}>{UNCHECKED_BANNER_COPY}</span>
        <a className={styles.back} href={checkedHref()} data-replay-back-to-checked>{BACK_TO_CHECKED_COPY}</a>
      </p>
    );
  }
  if (verification === "verified") {
    return <p className={styles.verified} data-strip={strip || undefined} data-replay-verified title={strip ? VERIFIED_NOTE_COPY : undefined}>{VERIFIED_NOTE_COPY}</p>;
  }
  return null;
}
