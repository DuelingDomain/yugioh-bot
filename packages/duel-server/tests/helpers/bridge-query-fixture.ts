import type Database from "better-sqlite3";
import { BridgeEngineQueries } from "../../src/bridge-engine-queries.js";
import { bridgeProjectionRows, type BridgeProjectionInput } from "../../src/bridge-projection-input.js";
import type { BridgeSearchQuery } from "../../src/bridge-search-jobs.js";

/** Local query adapters for lifecycle tests whose scanner/review work is mocked. */
export function bridgeQueryFixture(db: Database.Database) {
  const queries = new BridgeEngineQueries(db);
  return {
    bridgeResolve: async (input: Record<string, unknown>, guildId: string) => queries.resolve(input, guildId),
    bridgeDirectedProjection: async (query: BridgeSearchQuery, rows?: BridgeProjectionInput, deep = false) =>
      queries.projectDirected(query, rows ? bridgeProjectionRows(db, rows) : undefined, deep),
  };
}
