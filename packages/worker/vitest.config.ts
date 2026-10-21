import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["tests/**/*.test.ts"],
    // SQLite migrations and child-process startup share the CI runner's disk/CPU.
    // Run files serially so that contention cannot consume lifecycle deadlines.
    fileParallelism: false,
  },
});
