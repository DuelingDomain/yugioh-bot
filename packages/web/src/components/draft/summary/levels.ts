import { isExtraDeckMonster, isMonster, type CardSummary } from "@/lib/card-types";

export interface LevelBar {
  /** Star level shown under the bar ("8+" for the last bar). */
  label: string;
  count: number;
  /** Bar height as a fraction of the chart (0..1). */
  height: number;
}

export interface LevelBand {
  /** Tributes needed to Normal Summon: 0, 1 or 2. */
  tributes: 0 | 1 | 2;
  label: string;
  bars: LevelBar[];
  total: number;
}

export interface LevelsModel {
  bands: LevelBand[];
  total: number;
  ariaLabel: string;
}

const BANDS: Array<{ tributes: 0 | 1 | 2; label: string; bars: Array<{ label: string; min: number; max: number }> }> = [
  {
    tributes: 0,
    label: "No tribute",
    bars: [1, 2, 3, 4].map((n) => ({ label: String(n), min: n, max: n })),
  },
  {
    tributes: 1,
    label: "1 tribute",
    bars: [5, 6].map((n) => ({ label: String(n), min: n, max: n })),
  },
  {
    tributes: 2,
    label: "2 tributes",
    bars: [
      { label: "7", min: 7, max: 7 },
      { label: "8+", min: 8, max: Number.POSITIVE_INFINITY },
    ],
  },
];


/** Main-deck monsters by star level. Extra deck monsters are left out. */
export function buildLevelsModel(cards: CardSummary[]): LevelsModel {
  const levelled = cards.filter(
    (c) => isMonster(c.type) && !isExtraDeckMonster(c) && typeof c.level === "number",
  );
  const counted = BANDS.map((band) => ({
    ...band,
    bars: band.bars.map((bar) => ({
      label: bar.label,
      count: levelled.filter((c) => (c.level as number) >= bar.min && (c.level as number) <= bar.max).length,
    })),
  }));
  // The tallest bar fills the chart, the same scale the draft room uses.
  const tallest = Math.max(1, ...counted.flatMap((b) => b.bars.map((x) => x.count)));
  const bands: LevelBand[] = counted.map((band) => ({
    tributes: band.tributes,
    label: band.label,
    bars: band.bars.map((bar) => ({ ...bar, height: bar.count / tallest })),
    total: band.bars.reduce((sum, bar) => sum + bar.count, 0),
  }));
  const [none, one, two] = bands.map((b) => b.total);
  return {
    bands,
    total: none + one + two,
    ariaLabel:
      `Main deck monsters by level: ${none} ${none === 1 ? "needs" : "need"} no tribute, ` +
      `${one} ${one === 1 ? "needs" : "need"} one tribute, ` +
      `${two} ${two === 1 ? "needs" : "need"} two tributes`,
  };
}
