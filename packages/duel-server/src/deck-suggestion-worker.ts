import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import { createBridgeService, createCardInsightService, type BridgeService } from "@yugidraft/shared/services";
import { BridgeEngineQueries } from "./bridge-engine-queries.js";
import { BridgeJobError } from "./bridge-search-jobs.js";
import { bridgeProjectionRows } from "./bridge-projection-input.js";
import type { BridgeScan, BridgeEnginesScan, BridgeProjectionScan, SuggestionScan } from "./deck-suggestion-workers.js";

let db: Database.Database | undefined, path: string | undefined;
let bridges: BridgeService | undefined;
let engines: BridgeEngineQueries | undefined;
parentPort!.on("message", async (request: (SuggestionScan | BridgeScan | BridgeEnginesScan | BridgeProjectionScan) & {
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
      bridges = undefined; engines = undefined;
    }
    if ("kind" in request && request.kind === "bridge-engine-projection") {
      engines ??= new BridgeEngineQueries(db);
      const result = db.transaction(() => request.op === "shortlist"
        ? engines!.shortlist(request.rows, request.query) : engines!.project(bridgeProjectionRows(db!, request.rows), request.query, 6)).deferred();
      parentPort!.postMessage({ result });
      return;
    }
    if ("kind" in request && request.kind === "bridge-engines") {
      engines ??= new BridgeEngineQueries(db);
      const result = db.transaction(() => {
        const { query, detected } = engines!.resolve(request.input, request.guildId);
        return { ...engines!.project(engines!.service.engineRows(query.engines, query.format), query), ...(detected ? { detected } : {}) };
      }).deferred();
      parentPort!.postMessage({ result });
      return;
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
  } catch (error) { parentPort!.postMessage({ error: true, ...(error instanceof BridgeJobError
    ? { bridgeError: { message: error.message, status: error.status, retryAfter: error.retryAfter } } : {}) }); }
});
