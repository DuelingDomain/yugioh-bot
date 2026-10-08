import { isExtraDeckFrame } from "../services/card-catalog.js";
import { remapTargetMetadata } from "./engine-card-metadata.js";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MAX_CUBE_COPIES } from "../services/constants.js";

const cache = new Map<string, { stamp: string; remaps: ReadonlyMap<number, number> }>();
const codeIsValid = (code: unknown): code is number => typeof code === "number" && Number.isSafeInteger(code) && code > 0 && code <= 0xffffffff;

/** Old bundles have no remap file. New bundles require its exact manifest hash. */
export function loadCardPasscodeRemaps(directory: string): ReadonlyMap<number, number> {
  const root = resolve(directory), path = join(root, "card-remaps.json"), manifestPath = join(root, "manifest.json"), enginePath = join(root, "cards.cdb");
  const manifestStat = existsSync(manifestPath) ? statSync(manifestPath) : undefined;
  const remapStat = existsSync(path) ? statSync(path) : undefined;
  const engineStat = existsSync(enginePath) ? statSync(enginePath) : undefined;
  const stamp = `${manifestStat?.mtimeMs}:${manifestStat?.size}:${remapStat?.mtimeMs}:${remapStat?.size}:${engineStat?.mtimeMs}:${engineStat?.size}`;
  const cached = cache.get(root);
  if (cached?.stamp === stamp) return cached.remaps;
  const manifest = manifestStat ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const expected = manifest.integrity?.cardRemaps;
  if (!remapStat) {
    if (expected || /^official-releases-prerelease-v\d+$/.test(manifest.sources?.databaseFormat ?? "")) throw new Error("Missing card-remaps.json (integrity.cardRemaps)");
    return new Map();
  }
  const bytes = readFileSync(path);
  if (typeof expected !== "string" || createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("card-remaps.json does not match manifest integrity.cardRemaps");
  const artifact = JSON.parse(bytes.toString("utf8"));
  if (artifact.version !== 1 || !artifact.remaps || typeof artifact.remaps !== "object" || Array.isArray(artifact.remaps)) throw new Error("Invalid card-remaps.json");
  const remaps = new Map<number, number>();
  for (const [old, target] of Object.entries(artifact.remaps)) {
    if (!/^\d+$/.test(old) || !codeIsValid(Number(old)) || !codeIsValid(target) || Number(old) === target) throw new Error("Invalid passcode remap");
    remaps.set(Number(old), target);
  }
  // The first recipe could erase real artworks and omitted their alias metadata.
  // Without that source identity, its mappings cannot be safely migrated or read.
  if (remaps.size && manifest.sources?.databaseFormat === "official-releases-prerelease-v1") {
    throw new Error("Unsafe prerelease-v1 remaps: rebuild the engine bundle with the prerelease-v2 recipe");
  }
  if (remaps.size) {
    const engine = new Database(enginePath, { readonly: true, fileMustExist: true });
    try {
      const find = engine.prepare("SELECT alias,type FROM datas WHERE id=?");
      for (const old of remaps.keys()) {
        const row = find.get(old) as { alias: number; type: number } | undefined;
        if (row && (row.alias || (row.type & 0x4000))) {
          console.warn(`[card-remaps] Skipping retained ${row.alias ? "alternate artwork" : "token"} ${old}`);
          remaps.delete(old);
        }
      }
    } finally { engine.close(); }
  }
  // Resolve chains once and reject cycles before any writes.
  for (const [old, target] of remaps) {
    let code = target;
    const seen = new Set([old]);
    while (remaps.has(code)) {
      if (seen.has(code)) throw new Error(`Cyclic passcode remap ${old}`);
      seen.add(code); code = remaps.get(code)!;
    }
    remaps.set(old, code);
  }
  cache.set(root, { stamp, remaps });
  return remaps;
}

/** Only explicit deck passcode fields, preserving unrelated numbers and metadata. */
function remapDeck(value: Record<string, unknown>, remap: (code: number) => number) {
  const deck = { ...value };
  for (const field of ["main", "extra", "side"]) {
    if (Array.isArray(deck[field])) deck[field] = deck[field].map(code => typeof code === "number" ? remap(code) : code);
  }
  if (typeof deck.deckMaster === "number") deck.deckMaster = remap(deck.deckMaster);
  return deck;
}

/** Duel-server startup, after schema/bundle validation and before serving requests.
 * The immediate transaction makes parallel startups safe. Finished duel decks,
 * commands, setup scripts, seeds and snapshots are historical and never rewritten.
 */
export function applyEngineCardRemaps(db: Database.Database, directory: string): { skipped: boolean; remappedPasscodes: number } {
  const remaps = new Map(loadCardPasscodeRemaps(directory));
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (typeof manifest.bundleVersion !== "string" || !manifest.bundleVersion) throw new Error("Missing bundleVersion for passcode migration");
  const engine = new Database(join(directory, "cards.cdb"), { readonly: true, fileMustExist: true });
  let metadata: ReturnType<typeof remapTargetMetadata>;
  try {
    metadata = remapTargetMetadata(engine, remaps.values());
    const find = engine.prepare("SELECT 1 FROM datas WHERE id=?");
    for (const target of new Set(remaps.values())) if (!find.get(target)) throw new Error(`Remap target ${target} is absent from engine database`);
  } finally { engine.close(); }
  const remap = (code: number) => remaps.get(code) ?? code;
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM engine_card_remap_runs WHERE bundle_version=?").get(manifest.bundleVersion)) return { skipped: true, remappedPasscodes: 0 };
    // Catalog writers share this DB. Check artwork families under the same write
    // lock as the rewrite, so an intervening sync cannot turn a source into real art.
    const artwork = db.prepare("SELECT 1 FROM card_artworks WHERE artwork_id=? AND card_id<>artwork_id");
    for (const old of remaps.keys()) if (artwork.get(old)) {
      console.warn(`[card-remaps] Skipping alternate artwork ${old}`);
      remaps.delete(old);
    }
    const columns = (db.prepare("PRAGMA table_info(card_catalog)").all() as { name: string }[]).map(row => row.name);
    const quoted = columns.map(column => `"${column}"`);
    const copyCatalog = db.prepare(`INSERT OR IGNORE INTO card_catalog (${quoted.join(",")}) SELECT ${columns.map((column,index) => column === "ygoprodeck_id" ? "?" : quoted[index]).join(",")} FROM card_catalog WHERE ygoprodeck_id=?`);
    for (const [old, target] of remaps) {
      const copiedPreview = copyCatalog.run(target, old).changes > 0;
      if (copiedPreview) {
        db.prepare("UPDATE card_catalog SET image_url=?,image_url_small=? WHERE ygoprodeck_id=?").run(
          `https://images.ygoprodeck.com/images/cards/${target}.jpg`,
          `https://images.ygoprodeck.com/images/cards_small/${target}.jpg`, target);
      }
      const official = metadata.get(target);
      if (official && copiedPreview) {
        const fields = Object.keys(official);
        // Engine metadata is an offline fallback only for previews copied by
        // this run. Existing rows may have richer YGOPRODeck data even when
        // they have no TCG sets and their name differs from the engine name.
        db.prepare(`UPDATE card_catalog SET ${fields.map(field => `${field}=?`).join(",")} WHERE ygoprodeck_id=?`)
          .run(...Object.values(official), target);
      }
      // Graduated main passcodes are one card now; retain copies up to the cube cap.
      db.prepare(`INSERT INTO cube_cards (cube_id,catalog_card_id,pool,max_copies,source)
        SELECT cube_id,?,pool,max_copies,source FROM cube_cards WHERE catalog_card_id=?
        ON CONFLICT(cube_id,catalog_card_id) DO UPDATE SET max_copies=MIN(?,cube_cards.max_copies+excluded.max_copies)`).run(target, old, MAX_CUBE_COPIES);
      db.prepare("DELETE FROM cube_cards WHERE catalog_card_id=?").run(old);
      if (official) db.prepare("UPDATE cube_cards SET pool=? WHERE catalog_card_id=?").run(
        isExtraDeckFrame({ type: String(official.type), frameType: String(official.frame_type) }) ? "extra" : "main", target);
      for (const table of ["draft_cards", "draft_deal", "draft_undealt"]) db.prepare(`UPDATE ${table} SET catalog_card_id=? WHERE catalog_card_id=?`).run(target,old);
      db.prepare("DELETE FROM card_artworks WHERE artwork_id=?").run(old);
      db.prepare("UPDATE card_artworks SET card_id=?,is_main=0 WHERE card_id=?").run(target,old);
      db.prepare(`INSERT OR IGNORE INTO card_artworks (card_id,artwork_id,image_url,image_url_small,is_main,source)
        SELECT ygoprodeck_id,ygoprodeck_id,image_url,image_url_small,1,'engine' FROM card_catalog
        WHERE ygoprodeck_id=? AND NOT EXISTS (SELECT 1 FROM card_artworks WHERE card_id=? AND is_main=1)`).run(target,target);
      // Old metadata is just a cache. Remove it after every relational reference moved.
      db.prepare("DELETE FROM card_catalog WHERE ygoprodeck_id=?").run(old);
    }
    const rewriteJson = (table: string, column: string, transform: (value: Record<string, unknown>) => Record<string, unknown>, where = "1") => {
      const update = db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
      for (const row of db.prepare(`SELECT rowid AS rid,${column} AS json FROM ${table} WHERE ${column} IS NOT NULL AND (${where})`).all() as { rid: number; json: string }[]) {
        let value: unknown;
        try { value = JSON.parse(row.json); }
        catch {
          console.warn(`[card-remaps] Skipping invalid saved JSON in ${table}.${column} row ${row.rid}: cannot parse JSON`);
          continue;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          console.warn(`[card-remaps] Skipping invalid saved JSON in ${table}.${column} row ${row.rid}: expected a JSON object`);
          continue;
        }
        const next = transform(value as Record<string, unknown>);
        if (JSON.stringify(next) !== JSON.stringify(value)) update.run(JSON.stringify(next), row.rid);
      }
    };
    for (const table of ["saved_decks", "tournament_participants"]) rewriteJson(table, "deck_json", deck => remapDeck(deck,remap));
    rewriteJson("duel_seats","deck_json",deck=>remapDeck(deck,remap),"duel_id IN (SELECT id FROM duels WHERE status='lobby')");
    for (const column of ["base_deck0_json","base_deck1_json","deck0_json","deck1_json"]) rewriteJson("duel_series",column,deck=>remapDeck(deck,remap),"status IN ('active','between_games')");
    for (const table of ["cubes","drafts"]) rewriteJson(table,"config_json",value=>{
      const config = { ...value };
      for (const field of ["customCardIds","customExtraCardIds","cubeCardIds","poolCardIds"]) {
        if (Array.isArray(config[field])) config[field] = config[field].map(code=>typeof code === "number" ? remap(code) : code);
      }
      return config;
    });
    // Generated sandbox Lua has literal passcodes in Debug.AddCard's first argument.
    // Remap that explicit call only; keep arbitrary Lua constants and other numbers.
    rewriteJson("duels","setup_json",value=>({ ...value, ...(Array.isArray(value.startupScripts) ? { startupScripts:value.startupScripts.map(script => typeof script === "string" ? script.replace(/(Debug\.AddCard\(\s*)(\d+)(\s*,)/g,(_whole,prefix,code,suffix)=>`${prefix}${remap(Number(code))}${suffix}`) : script) } : {}) }),"status='lobby'");
    db.prepare("INSERT INTO engine_card_remap_runs(bundle_version) VALUES(?)").run(manifest.bundleVersion);
    return { skipped: false, remappedPasscodes: remaps.size };
  }).immediate();
}
