import type { SummonCircleTone } from "./summon-circle-model";
import styles from "./summon-circle.module.css";

/* Geometry is built once: a 200 x 200 viewBox centred on 0,0, so every ring shares one centre. */
const polar = (radius: number, degrees: number): [number, number] => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [Number((radius * Math.cos(radians)).toFixed(2)), Number((radius * Math.sin(radians)).toFixed(2))];
};

/** 72 tick marks between the two outer rings; every sixth one is longer. */
const TICKS = Array.from({ length: 72 }, (_, index) => {
  const angle = index * 5;
  const [x1, y1] = polar(91, angle);
  const [x2, y2] = polar(index % 6 === 0 ? 85 : 88, angle);
  return `M${x1} ${y1}L${x2} ${y2}`;
}).join("");

/** Four rune-like glyphs drawn in a small box around 0,0, repeated around the rune ring. */
const GLYPHS = [
  "M0 -5V5M0 -2L3 -5M0 1L3 -2",
  "M-2 -5V5M-2 -5L3 -1L-2 3",
  "M0 -5V5M-3 -2L3 2",
  "M-3 -5L0 0L3 -5M0 0V5",
];
const RUNES = Array.from({ length: 12 }, (_, index) => ({
  d: GLYPHS[index % GLYPHS.length],
  transform: `rotate(${index * 30}) translate(0 -71)`,
}));

const STAR_RADIUS = 56;
const TRIANGLES = [
  [0, 120, 240],
  [60, 180, 300],
].map((angles) => `M${angles.map((angle) => polar(STAR_RADIUS, angle).join(" ")).join("L")}Z`);
const STAR_DOTS = Array.from({ length: 6 }, (_, index) => polar(STAR_RADIUS, index * 60));

const MOTES = [
  { x: 22, delay: 0, time: 3.4 },
  { x: 38, delay: 1.1, time: 4.1 },
  { x: 52, delay: 2.2, time: 3.7 },
  { x: 64, delay: 0.6, time: 4.4 },
  { x: 78, delay: 1.7, time: 3.2 },
];

/**
 * The glow sits UNDER the pile's cards (z-index 0 inside the pile frame).
 * Render it next to <SummonCircle>, as a child of the same pile frame.
 */
export function SummonGlow({ tone }: { tone: SummonCircleTone }) {
  return <span className={styles.glow} data-tone={tone} aria-hidden="true" />;
}

/**
 * A slowly turning summoning circle drawn OVER the pile: line art, a light sweep and a few rising motes.
 * It takes no pointer input. Place it inside the pile frame, which is `position: relative`.
 */
export function SummonCircle({ tone }: { tone: SummonCircleTone }) {
  return (
    <span className={styles.circle} data-tone={tone} aria-hidden="true">
      <span className={styles.sweep} />
      <svg className={`${styles.layer} ${styles.outer}`} viewBox="-100 -100 200 200" focusable="false">
        <circle r="97" />
        <circle r="92" className={styles.fine} />
        <path d={TICKS} className={styles.fine} />
      </svg>
      <svg className={`${styles.layer} ${styles.runes}`} viewBox="-100 -100 200 200" focusable="false">
        <circle r="82" className={styles.fine} />
        <circle r="60" className={styles.fine} />
        {RUNES.map((rune) => (
          <path key={rune.transform} d={rune.d} transform={rune.transform} className={styles.rune} />
        ))}
      </svg>
      <svg className={`${styles.layer} ${styles.star}`} viewBox="-100 -100 200 200" focusable="false">
        <circle r={STAR_RADIUS} className={styles.fine} />
        {TRIANGLES.map((d) => (
          <path key={d} d={d} />
        ))}
        <circle r="28" className={styles.fine} />
        <path d="M0 -9L7 0L0 9L-7 0Z" className={styles.rune} />
        {STAR_DOTS.map(([x, y]) => (
          <circle key={`${x}:${y}`} cx={x} cy={y} r="2.4" className={styles.dot} />
        ))}
      </svg>
      {MOTES.map((mote) => (
        <span
          key={mote.x}
          className={styles.mote}
          style={{ left: `${mote.x}%`, animationDelay: `${mote.delay}s`, animationDuration: `${mote.time}s` }}
        />
      ))}
    </span>
  );
}
