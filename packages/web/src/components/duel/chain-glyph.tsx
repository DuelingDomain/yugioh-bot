import styles from "./chain-glyph.module.css";

/** Two interlocked links: the chain mark, on the field badge and in the pile viewer. */
export function ChainGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g transform="rotate(-40 12 12)" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
        <rect x="1.5" y="8" width="12" height="8" rx="4" />
        <rect x="10.5" y="8" width="12" height="8" rx="4" />
      </g>
    </svg>
  );
}
