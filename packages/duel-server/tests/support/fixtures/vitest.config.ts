import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Config for cores.test.ts only: runs the fixture files of this folder in a child Vitest process.
// The Vite cache goes to the temp folder, so the child run leaves nothing in the tests folder.
export default defineConfig({ cacheDir: join(tmpdir(), "duel-cores-fixture-vite"), test: { root: __dirname, include: ["*.fixture.test.ts"] } });
