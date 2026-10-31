import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate } from "@yugidraft/shared/db";
import { buildBridgeJudgeEvidence, importBridgeArtifact, readBridgeManifest } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import type { BridgeFormat } from "@yugidraft/shared/cards/effects";

export interface GoldenBridgePair {
  source: string; target: string; format: BridgeFormat; expected: "bridge" | "not_bridge";
  min_grade?: string; cards?: (number | string)[]; why: string; source_url: string;
  /** Deep-only labels do not enter strict Suggestions recall or precision. */
  tier?: "deep";
  /** A directed physical access regression, independent of the top-ten display cap. */
  access_path?: boolean;
  excluded_group?: boolean; rejected_evidence_cards?: (number | string)[];
}

export function evaluateBridges(path = resolve(import.meta.dirname, "../../packages/shared/data/effects/bridges-golden.json")) {
  const golden = JSON.parse(readFileSync(path, "utf8")) as { core_sources?: string[]; pairs: GoldenBridgePair[] };
  if (!Array.isArray(golden.pairs) || !golden.pairs.length || golden.pairs.some(pair => !["advanced", "genesys"].includes(pair.format) || !["bridge", "not_bridge"].includes(pair.expected) || pair.tier !== undefined && pair.tier !== "deep"
    || pair.access_path !== undefined && (typeof pair.access_path !== "boolean" || pair.tier !== "deep") || !pair.source || !pair.target || !pair.why || !pair.source_url)) throw new Error("Invalid or empty bridge golden set");
  const db = new Database(":memory:");
  try {
    migrate(db); importBridgeArtifact(db);
    const service = createBridgeService(db), manifest = readBridgeManifest();
    for (const pair of golden.pairs) {
      if (!manifest.groups[pair.source]) throw new Error(`Golden source group does not exist: ${pair.source}`);
      if (pair.excluded_group) {
        if (pair.expected !== "not_bridge" || manifest.groups[pair.target]) throw new Error(`Excluded label group is still an engine: ${pair.target}`);
      } else if (!manifest.groups[pair.target]) throw new Error(`Golden target group does not exist: ${pair.target}`);
    }
    const coreSources = golden.core_sources ?? [...new Set(golden.pairs.map(pair => pair.source))];
    for (const source of coreSources) if (!manifest.groups[source]) throw new Error(`Golden core source group does not exist: ${source}`);
    return Object.fromEntries((["advanced", "genesys"] as const).map(format => {
      const labels = golden.pairs.filter(pair => pair.format === format), sources = new Set(coreSources);
      let correct5 = 0, labelled5 = 0, positive4 = 0, positive10 = 0, positiveLabels = 0, retrieved5 = 0, deepPositiveLabels = 0, deepPositive10 = 0;
      let accessLabels = 0, accessHits = 0;
      const ranked = new Map([...new Set([...sources, ...labels.map(pair => pair.source)])].map(source => [source, service.bridgesFrom(source, format, 25)]));
      const deepRanked = new Map(labels.filter(pair => pair.tier === "deep").map(pair => [pair.source, service.deepFrom(pair.source, format, 10)]));
      const pairLabels = new Map<string, GoldenBridgePair>();
      for (const pair of labels.filter(pair => pair.tier !== "deep" && !pair.excluded_group && !pair.rejected_evidence_cards?.length)) {
        const key = `${pair.source.toLowerCase()}:${pair.target.toLowerCase()}`;
        if (pairLabels.has(key)) throw new Error(`Duplicate golden pair: ${pair.source} → ${pair.target} (${format})`);
        pairLabels.set(key, pair);
      }
      const outcomes = labels.map(pair => {
        const found = (pair.tier === "deep" ? deepRanked : ranked).get(pair.source)!, rank = pair.access_path ? 0 : found.findIndex(row => row.target.toLowerCase() === pair.target.toLowerCase()) + 1;
        const access = pair.access_path ? service.deepBetween(pair.source, pair.target, format) : null;
        const accessOk = !!access && !!buildBridgeJudgeEvidence(db, access);
        if (pair.expected === "bridge") {
          if (pair.access_path) { accessLabels++; if (accessOk) accessHits++; }
          else if (pair.tier === "deep") { deepPositiveLabels++; if (rank > 0 && rank <= 10) deepPositive10++; }
          else { positiveLabels++; if (rank > 0 && rank <= 10) positive10++;
            if (service.bridgesFrom(pair.source, format, 4).some(row => row.target.toLowerCase() === pair.target.toLowerCase())) positive4++; }
        }
        const bridge = pair.access_path ? accessOk ? access : null : rank ? found[rank - 1]! : null;
        const explained = pair.expected === "not_bridge" ? pair.tier === "deep" ? service.deepBetween(pair.source, pair.target, format) : service.explain(pair.source, pair.target, format) : null;
        const explainedNames = explained?.cards.map(id => (db.prepare("SELECT json_extract(capabilities_json,'$.card.name') AS name FROM card_capability WHERE passcode=?").get(id) as { name: string }).name) ?? [];
        const falseBridge = !!explained && (!pair.rejected_evidence_cards?.length || pair.rejected_evidence_cards.some(card => typeof card === "number" ? explained.cards.includes(card) : explainedNames.includes(card)));
        const grades = ["risky", "niche", "good", "strong"];
        const names = bridge?.cards.map(id => (db.prepare("SELECT json_extract(capabilities_json,'$.card.name') AS name FROM card_capability WHERE passcode=?").get(id) as { name: string }).name) ?? [];
        return { ...pair, rank: rank || null, ...(pair.access_path ? { access_ok: accessOk } : {}), grade: bridge?.grade ?? null, false_bridge: falseBridge,
          grade_ok: !pair.min_grade || !!bridge && grades.indexOf(bridge.grade.toLowerCase()) >= grades.indexOf(pair.min_grade.toLowerCase()),
          matched_evidence_cards: pair.cards?.filter(card => typeof card === "number" ? bridge?.cards.includes(card) : names.includes(card)) ?? [],
          available: !!manifest.groups[pair.source] && !!manifest.groups[pair.target] };
      });
      for (const source of sources) for (const bridge of ranked.get(source)!.slice(0, 5)) {
        retrieved5++;
        const label = pairLabels.get(`${source.toLowerCase()}:${bridge.target.toLowerCase()}`);
        if (label) { labelled5++; if (label.expected === "bridge") correct5++; }
      }
      return [format, { precision_at_5: retrieved5 ? correct5 / retrieved5 : null,
        precision_at_5_bounds: retrieved5 ? [correct5 / retrieved5, (correct5 + retrieved5 - labelled5) / retrieved5] : null,
        judged_precision_at_5: labelled5 ? correct5 / labelled5 : null, recall_at_4: positiveLabels ? positive4 / positiveLabels : null, recall_at_10: positiveLabels ? positive10 / positiveLabels : null,
        deep_recall_at_10: deepPositiveLabels ? deepPositive10 / deepPositiveLabels : null,
        deep_positive_labels: deepPositiveLabels, deep_hits_at_10: deepPositive10,
        access_path_labels: accessLabels, access_path_hits: accessHits, access_path_recall: accessLabels ? accessHits / accessLabels : null,
        known_false_bridges: outcomes.filter(pair => pair.false_bridge).length,
        labelled_top_5: labelled5, retrieved_top_5: retrieved5, judgement_coverage_at_5: retrieved5 ? labelled5 / retrieved5 : 0,
        positive_labels: positiveLabels, hits_at_10: positive10, outcomes }];
    }));
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = evaluateBridges(process.argv.find(arg => arg.endsWith(".json")));
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--check") && Object.values(result).some(row => row.known_false_bridges > 0 || row.judgement_coverage_at_5 < 0.8 || row.precision_at_5 === null || row.precision_at_5 < 0.9 || row.recall_at_10 !== null && row.recall_at_10 < 0.6 || row.deep_recall_at_10 !== null && row.deep_recall_at_10 < 1 || row.access_path_recall !== null && row.access_path_recall < 1 || row.outcomes.some(pair => pair.tier === "deep" && !pair.grade_ok))) process.exitCode = 1;
  if (process.argv.includes("--strict-precision") && Object.values(result).some(row => row.precision_at_5 === null || row.judgement_coverage_at_5 !== 1)) process.exitCode = 1;
}
