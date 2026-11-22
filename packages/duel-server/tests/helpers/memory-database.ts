import { migrate } from "@yugidraft/shared/db";
import { memoryDatabaseFixture } from "../../../shared/tests/helpers/sqlite-memory-fixture.mjs";

export const migratedMemoryDatabase = memoryDatabaseFixture(migrate);
