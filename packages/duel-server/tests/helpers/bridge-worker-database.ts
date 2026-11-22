import { writeFileSync } from "node:fs";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { memoryDatabaseFixture } from "../../../shared/tests/helpers/sqlite-memory-fixture.mjs";

export const bridgeDatabase = memoryDatabaseFixture(db => {
  migrate(db);
  importBridgeArtifact(db);
});

export const effectDatabase = memoryDatabaseFixture(db => {
  migrate(db);
  importBridgeArtifact(db);
  importCardEffectArtifact(db);
});

function writeDatabase(path: string, open: typeof bridgeDatabase): void {
  const db = open();
  try {
    writeFileSync(path, db.serialize());
  } finally {
    db.close();
  }
}

export const writeBridgeDatabase = (path: string) => writeDatabase(path, bridgeDatabase);
export const writeEffectDatabase = (path: string) => writeDatabase(path, effectDatabase);

// Allow projections and legality warmup to finish on loaded, single-CPU runners.
export const FAST_QUERY_TIMEOUT_MS = 60_000;
