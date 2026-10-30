import type { ArchetypeBridge, BridgeFormat, BridgeGrade, BridgeGraphData } from "./bridge-types.js";
import type { ShownBridge } from "./bridge-judge.js";

export interface EngineLink<T extends ArchetypeBridge = ShownBridge> { from: string; to: string; bridge: T }
export interface RankedEngine<T extends ArchetypeBridge = ShownBridge> {
  engine: string; score: number; grade: BridgeGrade; tier: "strict" | "niche";
  covered: number; of: number; twoWay: string[]; links: EngineLink<T>[];
}
export interface EngineSuggestion extends RankedEngine {
  cards: number[]; missing: number[]; genesysPoints: number | null; pros: string[]; cons: string[];
}
export interface BridgeEnginesResponse {
  engines: string[]; detected?: import("./bridge-engines.js").DetectedEngine[];
  between: ShownBridge[]; next: EngineSuggestion[]; inReview: number;
}
export interface EngineRankingContext {
  groups: BridgeGraphData["groups"]; hubs: ReadonlySet<number>;
  idf: Record<BridgeFormat, ReadonlyMap<string, number>>;
  related(a: string, b: string): boolean;
}

/** Compute once per artifact on host start, independently of review status. */
export function engineRankingStats(groups: BridgeGraphData["groups"], rows: readonly ArchetypeBridge[]) {
  const fanout = new Map<number, Set<string>>();
  const sources: Record<BridgeFormat, Map<string, Set<string>>> = { advanced: new Map(), genesys: new Map() };
  for (const row of rows) {
    const reason = row.reasons[0];
    const access = reason?.cost?.card ?? reason?.steps?.[0]?.from ?? reason?.cards[0];
    if (access !== undefined && !groups[row.source]?.includes(access) && !groups[row.target]?.includes(access)) {
      const pairs = fanout.get(access) ?? new Set<string>();
      pairs.add(JSON.stringify([row.source, row.target])); fanout.set(access, pairs);
    }
    const set = sources[row.format].get(row.target) ?? new Set<string>();
    set.add(row.source); sources[row.format].set(row.target, set);
  }
  const denominator = Math.max(1, Object.keys(groups).length);
  const scales = (format: BridgeFormat) => new Map([...sources[format]].map(([target, from]) => [target, Math.min(1, 0.05 / (from.size / denominator))]));
  const idf = { advanced: scales("advanced"), genesys: scales("genesys") };
  return { hubs: new Set([...fanout].filter(([, pairs]) => pairs.size >= 15).map(([id]) => id)), idf };
}

export function bridgeAccessPath(row: ArchetypeBridge, groups: BridgeGraphData["groups"]): string | undefined {
  const reason = row.reasons[0], first = reason?.steps?.[0], source = new Set(groups[row.source]);
  const access = reason?.cost?.using ?? reason?.materials?.[0] ?? reason?.cards.find(id => source.has(id));
  const entry = reason?.cost?.card ?? (first && (source.has(first.from) ? first.to : first.from));
  return access === undefined || entry === undefined ? undefined : JSON.stringify([row.format, access, entry]);
}
export const hubBridge = (row: ArchetypeBridge, context: EngineRankingContext) => row.reasons[0]?.cards.some(id => context.hubs.has(id)) ?? false;
export function bridgePairValue(row: ArchetypeBridge, context: EngineRankingContext): number {
  const grade = row.tier === "niche" ? 0.45 : ({ Strong: 1, Good: 0.8, Niche: 0.6, Risky: 0.3 } as const)[row.grade];
  return row.score * grade * (hubBridge(row, context) ? 0.25 : 1);
}

/** Internal deterministic shortlist; publication must pass accepted rows instead. */
export function rankEngineCandidates<T extends ArchetypeBridge>(engines: readonly string[], rows: readonly T[], context: EngineRankingContext, limit = 8): RankedEngine<T>[] {
  const selected = new Set(engines), byTarget = new Map<string, T[]>();
  for (const row of rows) {
    const target = selected.has(row.source) && !selected.has(row.target) ? row.target
      : selected.has(row.target) && !selected.has(row.source) ? row.source : undefined;
    if (!target || engines.some(source => context.related(source, target))) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), row]);
  }
  const value = (row: T) => bridgePairValue(row, context);
  const ranked: RankedEngine<T>[] = [];
  for (const [engine, pairs] of byTarget) {
    const best = (source: string, target: string) => pairs.filter(row => row.source === source && row.target === target)
      .sort((a, b) => value(b) - value(a) || a.evidence_hash.localeCompare(b.evidence_hash))[0];
    const forwards = engines.flatMap(source => { const row = best(source, engine); return row ? [row] : []; }).sort((a, b) => value(b) - value(a) || a.source.localeCompare(b.source));
    const back = engines.flatMap(target => { const row = best(engine, target); return row ? [row] : []; }).sort((a, b) => value(b) - value(a) || a.target.localeCompare(b.target))[0];
    const display = [...forwards.slice(0, back ? 2 : 3), ...(back ? [back] : [])];
    if (!display.length) continue;
    const links = engines.map(source => {
      const forward = display.find(row => row.source === source && row.target === engine);
      const reverse = display.find(row => row.source === engine && row.target === source);
      const f = forward ? value(forward) : 0, b = reverse ? value(reverse) : 0;
      return { source, value: Math.max(f, 0.7 * b) + 0.3 * Math.min(f, b),
        covered: !!forward && !hubBridge(forward, context) || !!reverse && !hubBridge(reverse, context), twoWay: !!forward && !!reverse };
    });
    const covered = links.filter(link => link.covered).length;
    const weights = [1, 0.8, 0.6, 0.5];
    const score = links.sort((a, b) => b.value - a.value).reduce((sum, link, i) => sum + link.value * weights[i]!, 0)
      * (1 + 0.3 * (covered - 1)) * (context.idf[display[0]!.format].get(engine) ?? 1);
    if (score < 4) continue;
    const strongest = [...display].sort((a, b) => value(b) - value(a))[0]!;
    const tier = display.every(row => row.tier === "niche") ? "niche" : "strict";
    ranked.push({ engine, score: Math.round(score * 1000) / 1000, grade: tier === "niche" ? "Niche" : strongest.grade, tier,
      covered, of: engines.length, twoWay: links.filter(link => link.twoWay).map(link => link.source).sort(),
      links: display.map(bridge => ({ from: bridge.source, to: bridge.target, bridge })) });
  }
  const paths = new Set<string>(), results: RankedEngine<T>[] = [];
  for (const row of ranked.sort((a, b) => b.score - a.score || a.engine.localeCompare(b.engine))) {
    const used = row.links.flatMap(link => { const path = bridgeAccessPath(link.bridge, context.groups); return path ? [path] : []; });
    if (used.some(path => paths.has(path))) continue;
    if (results.some(higher => {
      const ids = context.groups[row.engine] ?? [], other = new Set(context.groups[higher.engine]);
      return ids.length > 0 && ids.filter(id => other.has(id)).length >= 0.5 * ids.length;
    })) continue;
    results.push(row); used.forEach(path => paths.add(path));
    if (results.length >= limit) break;
  }
  return limit > 0 ? results : [];
}

/** Only accepted displayed pairs contribute to score, coverage, or two-way claims. */
export function rankNextEngines(engines: readonly string[], rows: readonly ShownBridge[], context: EngineRankingContext, limit = 4): RankedEngine[] {
  return rankEngineCandidates(engines, rows.filter(row => row.judge === "accepted"), context, limit);
}
