import { configDefaults, defineConfig } from "vitest/config";

// domain-core/.build holds C++ build trees and a frozen copy of this package's tests (the core gate harness).
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "domain-core/**"] } });
