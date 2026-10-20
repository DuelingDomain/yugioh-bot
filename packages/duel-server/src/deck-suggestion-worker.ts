import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import { createCardInsightService } from "@yugidraft/shared/services";
import type { SuggestionScan } from "./deck-suggestion-workers.js";

let db: Database.Database | undefined, path: string | undefined;
parentPort!.on("message", ({ query, legality, deckMaster, database, dataDirectory }: SuggestionScan & {
  database: string | Uint8Array; dataDirectory: string;
}) => {
  try {
    if (typeof database !== "string" || path !== database || !db) {
      db?.close();
      db = typeof database === "string"
        ? new Database(database, { readonly: true, fileMustExist: true })
        : new Database(Buffer.from(database));
      path = typeof database === "string" ? database : undefined;
    }
    const insights = createCardInsightService(db, { dataDirectory });
    const suggestionContext = { cache: false as const, deck: query.deck, legality, banlist: query.banlist, exclude: query.exclude };
    const result = query.op === "suggestRows"
      ? insights.suggestRows(query.deck, { ...query, deckMaster, legality, cache: false })
      : insights.effectSearch(query.text, query.pool, { ...query, deckMaster, suggestionContext });
    parentPort!.postMessage({ result });
  } catch { parentPort!.postMessage({ error: true }); }
});
