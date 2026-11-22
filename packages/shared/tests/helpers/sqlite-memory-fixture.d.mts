import type Database from "better-sqlite3";

export function memoryDatabaseFixture(initialize: (db: Database.Database) => void): () => Database.Database;
