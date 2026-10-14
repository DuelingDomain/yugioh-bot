import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isExtraDeckCard } from "@yugidraft/shared/duels";
import { createDeckTypeLookup, loadArtworkIdentityCatalog, mainArtworkId } from "@yugidraft/shared/services";

// Only read the supplied API snapshot and engine bundle. Never open an application database.
const [snapshotPath, engineDirectory] = process.argv.slice(2);
if (!snapshotPath || !engineDirectory) throw new Error("Usage: tsx scripts/scan-extra-deck-lookups.ts <ygoprodeck.json> <engine-directory>");
const snapshot = readFileSync(resolve(snapshotPath));
const cards = (JSON.parse(snapshot.toString("utf8")) as { data: Array<{
  id: number; name: string; type: string; frameType: string;
  card_images: Array<{ id: number }>;
}> }).data;
const engine = loadArtworkIdentityCatalog(resolve(engineDirectory));
const db = new Database(":memory:");
try {
  db.exec(`create table card_catalog(ygoprodeck_id integer primary key, type text, name text, frame_type text);
    create table card_artworks(artwork_id integer primary key, card_id integer);`);
  const insert = db.prepare("insert or replace into card_catalog values (?,?,?,?)");
  const artwork = db.prepare("insert or replace into card_artworks values (?,?)");
  db.transaction(() => {
    for (const card of cards) {
      const base = mainArtworkId(card, engine) ?? card.id;
      for (const code of new Set([base, card.id, ...card.card_images.map(image => image.id)])) {
        insert.run(code, card.type ?? "", card.name, card.frameType ?? "");
        artwork.run(code, base);
      }
    }
  })();
  const catalogOnly = createDeckTypeLookup(db, new Map()).snapshot();
  const fixed = createDeckTypeLookup(db, engine).snapshot();
  const candidates = [...engine].filter(([, card]) => !card.alias && isExtraDeckCard(card)).sort(([a], [b]) => a - b);
  const describe = ([code, card]: typeof candidates[number]) => ({ code, name: card.name, type: card.type });
  const unresolved = candidates.filter(([code]) => !catalogOnly(code));
  const invalid = candidates.filter(([code]) => catalogOnly(code) && !isExtraDeckCard(catalogOnly(code)));
  const remaining = candidates.filter(([code]) => !isExtraDeckCard(fixed(code)));
  console.log(JSON.stringify({
    source: "https://db.ygoprodeck.com/api/v7/cardinfo.php",
    snapshotSha256: createHash("sha256").update(snapshot).digest("hex"),
    snapshotCards: cards.length, engineDirectory: resolve(engineDirectory),
    engineExtraNonAlias: candidates.length, unresolvedWithoutEngine: unresolved.length,
    invalidWithoutEngine: invalid.length, remainingAfterFix: remaining.length,
    affected: unresolved.map(describe), invalid: invalid.map(describe), remaining: remaining.map(describe),
    magia: { engine: engine.get(12381100), catalog: catalogOnly(12381100), fixed: fixed(12381100) },
  }, null, 2));
} finally { db.close(); }
