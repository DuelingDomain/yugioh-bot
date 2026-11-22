import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";

function databaseSnapshot(initialize) {
  let snapshot;
  return () => {
    if (!snapshot) {
      const template = new Database(":memory:");
      try {
        initialize(template);
        snapshot = template.serialize();
      } finally {
        template.close();
      }
    }
    return snapshot;
  };
}

/** Build the fixture once per isolated test file and give each case its own writable database. */
export function memoryDatabaseFixture(initialize) {
  const snapshot = databaseSnapshot(initialize);
  return () => new Database(snapshot());
}

/** Seed a fresh file in a test's private directory for tests that use real SQLite connections and locks. */
export function fileDatabaseFixture(initialize) {
  const snapshot = databaseSnapshot(initialize);
  return (path, options) => {
    writeFileSync(path, snapshot(), { flag: "wx" });
    return new Database(path, options);
  };
}
