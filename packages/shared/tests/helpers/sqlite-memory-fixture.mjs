import Database from "better-sqlite3";

/** Build the fixture once per isolated test file and give each case its own writable database. */
export function memoryDatabaseFixture(initialize) {
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
    return new Database(snapshot);
  };
}
