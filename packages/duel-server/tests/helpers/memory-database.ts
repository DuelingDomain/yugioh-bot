import { migrate } from "@yugidraft/shared/db";
import { fileDatabaseFixture, memoryDatabaseFixture } from "../../../shared/tests/helpers/sqlite-memory-fixture.mjs";

export const migratedMemoryDatabase = memoryDatabaseFixture(migrate);
export const migratedFileDatabase = fileDatabaseFixture(migrate);
