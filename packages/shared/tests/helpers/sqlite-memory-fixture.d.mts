import type Database from "better-sqlite3";

export function memoryDatabaseFixture(initialize: (db: Database.Database) => void): () => Database.Database;
export function fileDatabaseFixture(initialize: (db: Database.Database) => void): (path: string, options?: Database.Options) => Database.Database;
