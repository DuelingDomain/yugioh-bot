import { migrate } from "../../src/db/schema.js";
import { fileDatabaseFixture, memoryDatabaseFixture } from "./sqlite-memory-fixture.mjs";

export { memoryDatabaseFixture };
export const migratedMemoryDatabase = memoryDatabaseFixture(migrate);
export const migratedFileDatabase = fileDatabaseFixture(migrate);
