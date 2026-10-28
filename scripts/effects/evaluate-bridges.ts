import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, readBridgeManifest } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import type { BridgeFormat } from "@yugidraft/shared/cards/effects";

export interface GoldenBridgePair {
  source: string; target: string; format: BridgeFormat; expected: "bridge" | "not_bridge";
  min_grade?: string; cards?: (number | string)[]; why: string; source_url: string;
}

export function evaluateBridges(path = resolve(import.meta.dirname, "../../packages/shared/data/effects/bridges-golden.json")) {
  const golden = JSON.parse(readFileSync(path, "utf8")) as { pairs: GoldenBridgePair[] };
  if (!Array.isArray(golden.pairs) || !golden.pairs.length || golden.pairs.some(pair => !["advanced", "genesys"].includes(pair.format) || !["bridge", "not_bridge"].includes(pair.expected) || !pair.source || !pair.target || !pair.why || !pair.source_url)) throw new Error("Invalid or empty bridge golden set");
  const db = new Database(":memory:");
  try {
    migrate(db); importBridgeArtifact(db);
    const service = createBridgeService(db), manifest = readBridgeManifest();
    return Object.fromEntries((["advanced", "genesys"] as const).map(format => {
      const labels = golden.pairs.filter(pair => pair.format === format), sources = new Set(labels.map(pair => pair.source));
      let correct5 = 0, labelled5 = 0, positive10 = 0, positiveLabels = 0, retrieved5 = 0;
      const outcomes = labels.map(pair => {
        const found = service.bridgesFrom(pair.source, format, 25), rank = found.findIndex(row => row.target.toLowerCase() === pair.target.toLowerCase()) + 1;
        if (pair.expected === "bridge") { positiveLabels++; if (rank > 0 && rank <= 10) positive10++; }
        if (rank > 0 && rank <= 5) { labelled5++; if (pair.expected === "bridge") correct5++; }
        const bridge = rank ? found[rank - 1]! : null;
        const falseBridge = pair.expected === "not_bridge" && service.explain(pair.source, pair.target, format) !== null;
        const grades = ["risky", "niche", "good", "strong"];
        const names = bridge?.cards.map(id => (db.prepare("SELECT json_extract(capabilities_json,'$.card.name') AS name FROM card_capability WHERE passcode=?").get(id) as { name: string }).name) ?? [];
        return { ...pair, rank: rank || null, grade: bridge?.grade ?? null, false_bridge: falseBridge,
          grade_ok: !pair.min_grade || !!bridge && grades.indexOf(bridge.grade.toLowerCase()) >= grades.indexOf(pair.min_grade.toLowerCase()),
          matched_evidence_cards: pair.cards?.filter(card => typeof card === "number" ? bridge?.cards.includes(card) : names.includes(card)) ?? [],
          available: !!manifest.groups[pair.source] && !!manifest.groups[pair.target] };
      });
      for (const source of sources) retrieved5 += service.bridgesFrom(source, format, 5).length;
      return [format, { precision_at_5: retrieved5 && labelled5 === retrieved5 ? correct5 / retrieved5 : null,
        precision_at_5_bounds: retrieved5 ? [correct5 / retrieved5, (correct5 + retrieved5 - labelled5) / retrieved5] : null,
        judged_precision_at_5: labelled5 ? correct5 / labelled5 : null, recall_at_10: positiveLabels ? positive10 / positiveLabels : null,
        known_false_bridges: outcomes.filter(pair => pair.false_bridge).length,
        labelled_top_5: labelled5, retrieved_top_5: retrieved5, judgement_coverage_at_5: retrieved5 ? labelled5 / retrieved5 : 0,
        positive_labels: positiveLabels, hits_at_10: positive10, outcomes }];
    }));
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = evaluateBridges(process.argv.find(arg => arg.endsWith(".json")));
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--check") && Object.values(result).some(row => row.known_false_bridges > 0 || row.judged_precision_at_5 !== null && row.judged_precision_at_5 < 0.9 || row.recall_at_10 !== null && row.recall_at_10 < 0.6)) process.exitCode = 1;
  if (process.argv.includes("--strict-precision") && Object.values(result).some(row => row.precision_at_5 === null)) process.exitCode = 1;
}
