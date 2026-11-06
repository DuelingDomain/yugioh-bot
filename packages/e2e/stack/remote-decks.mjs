// A legal 40-card Main Deck of Normal Monsters, read from the prepared engine data. No Extra Deck, so no extra rules apply.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** The engine data folder: `DUEL_DATA_DIR`, this checkout, or the main checkout above `.worktrees`. */
export function engineDataDirectory() {
  const candidates = [process.env.DUEL_DATA_DIR, resolve(root, "data/duel-engine"), resolve(root, "../../data/duel-engine")];
  const found = candidates.find(path => path && existsSync(resolve(path, "cards.cdb")));
  if (!found) throw new Error("Engine card data is missing. Run `npm run duel:prepare` or set DUEL_DATA_DIR.");
  return found;
}

export function remoteTestDeck(directory = engineDataDirectory()) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const cards = new Database(resolve(directory, "cards.cdb"), { readonly: true });
  try {
    const ids = cards.prepare("select id from datas where type=17 and level between 1 and 4 and id between 1000000 and 99999999 order by id limit 14").all().map(row => row.id);
    const main = ids.flatMap(id => [id, id, id]).slice(0, 40);
    return { name: "Remote e2e · Normals", mode: "normal", deck: { main, extra: [], side: [] } };
  } finally { cards.close(); }
}
