import type { UsableGlowTone } from "./usable-glow-model";
import styles from "./usable-glow.module.css";

/**
 * A glow around a card that has a legal move: a pulsing halo, a slow wedge of light that circles a thin
 * rim, and an optional text tag (the cue that does not rely on colour). Same tones as the summoning circle.
 *
 * Put it inside the card's box, which must be `position: relative`; it draws just outside that box and
 * takes no pointer input. Set `--ug-r` on the card box to its corner radius so the rim follows the corners.
 * Motion is transform and opacity only. It stands still when `still` is set, under
 * `[data-reduced-motion="true"]` (the field's felt) and under prefers-reduced-motion.
 */
export function UsableGlow({
  tone,
  label,
  still = false,
}: {
  tone: UsableGlowTone;
  /** Short word shown in a small tag on the top edge, e.g. "Use". Leave out for glow only. */
  label?: string;
  still?: boolean;
}) {
  return (
    <span className={styles.glow} data-tone={tone} data-still={still ? "true" : undefined} aria-hidden="true">
      <span className={styles.halo} />
      <span className={styles.rim}>
        <span className={styles.light} />
      </span>
      {label ? <span className={styles.tag}>{label}</span> : null}
    </span>
  );
}
