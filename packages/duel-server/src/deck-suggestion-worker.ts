import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import { createBridgeService, createCardInsightService, type BridgeService } from "@yugidraft/shared/services";
import type { BridgeScan, SuggestionScan } from "./deck-suggestion-workers.js";

let db: Database.Database | undefined, path: string | undefined;
let bridges: BridgeService | undefined;
parentPort!.on("message", async (request: (SuggestionScan | BridgeScan) & {
  database: string | Uint8Array; dataDirectory: string;
}) => {
  try {
    const { database, dataDirectory } = request;
    if (typeof database !== "string" || path !== database || !db) {
      db?.close();
      db = typeof database === "string"
        ? new Database(database, { readonly: true, fileMustExist: true, timeout: 5000 })
        : new Database(Buffer.from(database));
      path = typeof database === "string" ? database : undefined;
      bridges = undefined;
    }
    if ("kind" in request && request.kind === "bridges") {
      bridges ??= createBridgeService(db);
      const { source, format } = request;
      const result = request.op === "from" ? bridges.bridgesFrom(source, format, request.limit)
        : request.op === "between" ? bridges.bridgeBetween(source, request.target, format)
        : request.op === "explain" ? bridges.deepBetween(source, request.target, format)
        : request.op === "into" ? bridges.deepInto(source, format, progress => parentPort!.postMessage({ progress }))
        : request.op === "outgoing" ? bridges.deepCandidates(source, format, progress => parentPort!.postMessage({ progress }), false)
        : bridges.deepCandidates(source, format, progress => parentPort!.postMessage({ progress }));
      parentPort!.postMessage({ result });
      return;
    }
    const { query, legality, deckMaster, guildId } = request as SuggestionScan;
    const insights = createCardInsightService(db, { dataDirectory, guildId });
    const suggestionContext = { cache: false as const, deck: query.deck, legality, banlist: query.banlist, exclude: query.exclude };
    const result = query.op === "suggestRows"
      ? insights.suggestRows(query.deck, { ...query, deckMaster, legality, cache: false })
      : insights.effectSearch(query.text, query.pool, { ...query, deckMaster, suggestionContext });
    parentPort!.postMessage({ result });
  } catch { parentPort!.postMessage({ error: true }); }
});
