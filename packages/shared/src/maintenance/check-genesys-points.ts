import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { GENESYS_POINTS_SOURCE_URL, GENESYS_VERIFIED_MINIMUM_CARDS, parseGenesysPointsResponse, type GenesysPointsCard } from "../services/genesys-points.js";

// Explicitly verified against Konami's English table on 2026-10-15. Keep these
// visible in the report; fuzzy name matching could conceal a different identity.
const SOURCE_NAMES: Record<string, string> = {
  "Stellarnova Binding": "Stellarnova Bonds",
  "Exstellarknight Constellar Ptolemy O7": "Exstellarknight Constellar Ptolemy Ω7",
};

export function compareGenesysPoints(cards: readonly GenesysPointsCard[], official: Readonly<Record<string, number>>) {
  const source = new Map(cards.map(card => [card.name, card.points]));
  const matched = new Set<string>();
  const nameMismatches: Array<{ officialName: string; sourceName: string }> = [];
  const pointMismatches: Array<{ officialName: string; sourceName: string; expected: number; actual: number }> = [];
  const missingCards: string[] = [];
  let checked = 0;
  for (const [officialName, expected] of Object.entries(official)) {
    const sourceName = source.has(officialName) ? officialName : SOURCE_NAMES[officialName];
    const actual = source.get(sourceName);
    if (actual === undefined) { missingCards.push(officialName); continue; }
    checked++;
    matched.add(sourceName);
    if (sourceName !== officialName) nameMismatches.push({ officialName, sourceName });
    if (actual !== expected) pointMismatches.push({ officialName, sourceName, expected, actual });
  }
  const unexpectedCards = [...source].filter(([name, points]) => points > 0 && !matched.has(name)).map(([name]) => name);
  return { checked, nameMismatches, pointMismatches, missingCards, unexpectedCards };
}

/** Read-only: compare a fresh TCG response (or saved API dump) with an official table. */
async function main() {
  const { values } = parseArgs({ options: { official: { type: "string" }, "api-snapshot": { type: "string" } } });
  const official = JSON.parse(readFileSync(values.official
    ?? new URL("../../tests/fixtures/genesys-official-2026-10-05.json", import.meta.url), "utf8")) as Record<string, number>;
  if (!official || typeof official !== "object" || Array.isArray(official)
    || Object.keys(official).length === 0 || Object.values(official).some(points => !Number.isSafeInteger(points) || points <= 0)) {
    throw new Error("Invalid official Genesys table (expected name-to-positive-points JSON)");
  }
  let payload: unknown;
  if (values["api-snapshot"]) payload = JSON.parse(readFileSync(values["api-snapshot"], "utf8"));
  else {
    const response = await fetch(GENESYS_POINTS_SOURCE_URL, { signal: AbortSignal.timeout(120_000), redirect: "error" });
    if (!response.ok) throw new Error(`Genesys request failed (${response.status})`);
    payload = await response.json();
  }
  // This command verifies against the supplied official table and never publishes.
  // Allow the same bounded catalog cleanup that an exactly approved sync can accept.
  const snapshot = parseGenesysPointsResponse(payload, GENESYS_VERIFIED_MINIMUM_CARDS);
  const result = compareGenesysPoints(snapshot.cards, official);
  console.log(JSON.stringify({ sourceUrl: GENESYS_POINTS_SOURCE_URL, revision: snapshot.revision, ...result }, null, 2));
  if (result.pointMismatches.length || result.missingCards.length || result.unexpectedCards.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
