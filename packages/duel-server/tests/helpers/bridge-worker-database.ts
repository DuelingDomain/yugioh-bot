import type Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { fileDatabaseFixture, memoryDatabaseFixture } from "../../../shared/tests/helpers/sqlite-memory-fixture.mjs";

function seedBridgeDatabase(db: Database.Database): void {
  migrate(db);
  importBridgeArtifact(db);
}

function seedEffectDatabase(db: Database.Database): void {
  seedBridgeDatabase(db);
  importCardEffectArtifact(db);
}

export const bridgeDatabase = memoryDatabaseFixture(seedBridgeDatabase);
export const effectDatabase = memoryDatabaseFixture(seedEffectDatabase);
export const bridgeFileDatabase = fileDatabaseFixture(seedBridgeDatabase);
export const effectFileDatabase = fileDatabaseFixture(seedEffectDatabase);

// Allow projections and legality warmup to finish on loaded, single-CPU runners.
export const FAST_QUERY_TIMEOUT_MS = 60_000;
