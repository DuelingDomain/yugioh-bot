/** Derive compact bridge priors and member copy statistics; raw lists stay local. */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { BridgeEngine } from "../../packages/shared/src/cards/effects/bridge-engine.js";
import { detectDeckEngines, type BridgeDeck } from "../../packages/shared/src/cards/effects/bridge-engines.js";
import { validateBridgeObservations, type BridgeObservations } from "../../packages/shared/src/cards/effects/bridge-observations.js";
import type { CardCapability } from "../../packages/shared/src/cards/effects/bridge-types.js";

const [listsPath, usagePath, output] = process.argv.slice(2);
if (!listsPath || !usagePath || !output) throw Error("Usage: bridge-observations.ts LISTS USAGE OUTPUT");
const usage = JSON.parse(readFileSync(usagePath, "utf8"));
const priorUsage = JSON.parse(readFileSync("packages/shared/data/staples/usage.json", "utf8"));
let prior: BridgeObservations | undefined;
try { prior=validateBridgeObservations(JSON.parse(readFileSync("packages/shared/data/staples/bridge-observations.json","utf8"))); } catch { /* First build has no prior artifact. */ }
const manifest = JSON.parse(readFileSync("packages/shared/data/effects/bridges-manifest.json", "utf8"));
const capabilities = gunzipSync(readFileSync("packages/shared/data/effects/card-capabilities.jsonl.gz")).toString().trim().split("\n").map(line => JSON.parse(line) as CardCapability);
const engine = new BridgeEngine({ ...manifest, capabilities });
const canonical = new Map<number, number>();
for (const row of capabilities) { canonical.set(row.id, row.id); for (const alias of row.card.aliases ?? []) canonical.set(alias,row.id); }
// The catalog's artwork identities are present in the card metadata artifact.
const tags = gunzipSync(readFileSync("packages/shared/data/effects/tags.jsonl.gz")).toString().trim().split("\n").map(line => JSON.parse(line));
const skip = new Set<number>(tags.filter(row => row.tags.roles.includes("hand_trap")).map(row => row.id));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const formats: BridgeObservations["formats"] = {};
for (const [format, lists] of Object.entries(JSON.parse(readFileSync(listsPath, "utf8"))) as [keyof typeof formats, (BridgeDeck & { url: string })[]][]) {
  // Failed source refreshes retain the previous derived sample, not the small
  // historical raw-list fixture that is still shipped for offline benchmarks.
  if (prior?.usageVersion === priorUsage.version && prior.formats[format]
    && JSON.stringify(usage.formats[format]) === JSON.stringify(priorUsage.formats[format])) {
    formats[format]=prior.formats[format]; continue;
  }
  const unique = new Map<string, BridgeDeck>();
  for (const list of lists) {
    const deck = { main: list.main.map(id => canonical.get(id) ?? id), extra: list.extra.map(id => canonical.get(id) ?? id) };
    // Side does not establish an engine or count as a second distinct list.
    unique.set(hash([deck.main.toSorted((a,b)=>a-b), deck.extra.toSorted((a,b)=>a-b)]), deck);
  }
  const engines: NonNullable<typeof formats.tcg>["engines"] = {}, pairs = new Map<string, number>();
  for (const deck of unique.values()) {
    const detected = detectDeckEngines(deck, engine.data.groups, skip).filter(row => row.status === "engine" && !/^(?:Mulcharmy|Dominus)$/i.test(row.name));
    for (const { name } of detected) {
      const row = engines[name] ??= { decks: 0, cards: [] }; row.decks++;
      const members = new Set(engine.data.groups[name]);
      const counts = new Map<number, number>();
      for (const code of [...deck.main, ...deck.extra]) if (members.has(code)) counts.set(code, Math.min(3, (counts.get(code) ?? 0) + 1));
      for (const [code, copies] of counts) {
        let card = row.cards.find(card => card.code === code);
        if (!card) { card = { code, decks: 0, copies: 0 }; row.cards.push(card); }
        card.decks++; card.copies += copies;
      }
    }
    const names = detected.map(row => row.name).sort((a,b)=>a.localeCompare(b));
    for (let i=0; i<names.length; i++) for (const b of names.slice(i+1)) {
      const a=names[i]!;
      if (!engine.relatedEngines(a,b)) { const key=JSON.stringify([a,b]); pairs.set(key,(pairs.get(key)??0)+1); }
    }
  }
  for (const row of Object.values(engines)) row.cards.sort((a,b)=>b.decks-a.decks || a.code-b.code);
  const deckCount=unique.size;
  formats[format] = { deckCount, engines: Object.fromEntries(Object.entries(engines).sort(([a],[b])=>a.localeCompare(b))),
    pairs: [...pairs].map(([key,decks])=>{const [a,b]=JSON.parse(key) as [string,string];const aDecks=engines[a]!.decks,bDecks=engines[b]!.decks;
      return {a,b,decks,aDecks,bDecks,share:decks/deckCount,aShare:decks/aDecks,bShare:decks/bDecks,lift:decks*deckCount/(aDecks*bDecks)};})
      .sort((a,b)=>b.decks-a.decks || a.a.localeCompare(b.a) || a.b.localeCompare(b.b)) };
  console.log(`${format}: ${deckCount} distinct lists; ${Object.keys(engines).length} engines; ${pairs.size} unrelated pairs`);
}
const identity={schemaVersion:1 as const,generatedAt:usage.generatedAt,usageVersion:usage.version,graphVersion:manifest.version,formats};
writeFileSync(output,JSON.stringify(validateBridgeObservations({...identity,version:hash(identity)}))+"\n");
