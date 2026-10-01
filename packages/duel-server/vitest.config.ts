import { configDefaults, defineConfig } from "vitest/config";

// domain-core/.build holds C++ build trees and a frozen copy of this package's tests (the core gate harness).
// tests/support/fixtures holds files that tests/support/cores.test.ts runs in a child process.
// tests/support/setup.ts gives every test file the same default engine data directory (tests/engine-data-dir.ts).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "domain-core/**", "tests/support/fixtures/**"], setupFiles: ["./tests/support/setup.ts"] },
});
