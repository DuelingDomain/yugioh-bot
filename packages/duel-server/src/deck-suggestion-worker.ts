import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import { createBridgeService, createCardInsightService, type BridgeService } from "@yugidraft/shared/services";
import type { BridgeScan, SuggestionScan } from "./deck-suggestion-workers.js";
import { judgeBridgePair } from "@yugidraft/shared/cards/effects";
import type { ArchetypeBridge } from "@yugidraft/shared/cards/effects";

let db: Database.Database | undefined, path: string | undefined;
let bridges: BridgeService | undefined;
let writable = false;
parentPort!.on("message", async (request: (SuggestionScan | BridgeScan | { kind: "bridge-judge"; bridge: ArchetypeBridge }) & {
  database: string | Uint8Array; dataDirectory: string;
}) => {
  try {
    const { database, dataDirectory } = request;
    const judging = "kind" in request && request.kind === "bridge-judge";
    if (typeof database !== "string" || path !== database || !db || writable !== judging) {
      db?.close();
      db = typeof database === "string"
        ? new Database(database, { readonly: !judging, fileMustExist: true, timeout: 5000 })
        : new Database(Buffer.from(database));
      path = typeof database === "string" ? database : undefined;
      bridges = undefined;
      writable = judging;
    }
    if ("kind" in request && request.kind === "bridge-judge") {
      await judgeBridgePair(db, request.bridge, { apiKey: process.env.ANTHROPIC_API_KEY, signal: AbortSignal.timeout(110_000),
        log: entry => console.info(JSON.stringify({ event: "bridge-judge-spend", ...entry })) });
      parentPort!.postMessage({ result: null });
      return;
    }
    if ("kind" in request && request.kind === "bridges") {
      bridges ??= createBridgeService(db);
      const { source, format } = request;
      const result = request.op === "from" ? bridges.bridgesFrom(source, format, request.limit)
        : request.op === "between" ? bridges.bridgeBetween(source, request.target, format)
        : request.op === "explain" ? bridges.explain(source, request.target, format)
        : bridges.liveCandidates(source, format, progress => parentPort!.postMessage({ progress }));
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
