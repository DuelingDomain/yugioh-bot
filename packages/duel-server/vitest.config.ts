import { configDefaults, defineConfig } from "vitest/config";

// domain-core/.build holds C++ build trees and a frozen copy of this package's tests (the core gate harness).
// tests/support/setup.ts gives every test file the same default engine data directory (tests/engine-data-dir.ts).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "domain-core/**"], setupFiles: ["./tests/support/setup.ts"] },
});
