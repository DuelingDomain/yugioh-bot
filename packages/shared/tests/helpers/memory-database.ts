import { migrate } from "../../src/db/schema.js";
import { memoryDatabaseFixture } from "./sqlite-memory-fixture.mjs";

export { memoryDatabaseFixture };
export const migratedMemoryDatabase = memoryDatabaseFixture(migrate);
