import { TriangleAlert } from "lucide-react";
import type { ReplayVerification } from "./api";
import { UNCHECKED_BANNER_COPY } from "./replay-controller";
import styles from "./replay-verification.module.css";

export const VERIFIED_NOTE_COPY = "Checked with current card data";

/**
 * What the replay tells about its check. An unchecked replay (the owner opened it without the check) gets a compact
 * warning line; a replay that was checked against the saved final board gets a quiet note; an exact replay
 * (or an older server's answer) shows nothing. It sits in the info area of each layout, never over the table.
 * `strip` is the one-line form for the free-for-all strip, whose height the board reserves.
 */
export function ReplayVerificationNote({ verification, strip = false }: { verification: ReplayVerification; strip?: boolean }) {
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
