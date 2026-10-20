import { defineConfig } from "vitest/config";

// The shared suite runs 2,400+ tests in parallel. Several service tests take 2-3 s on a fast machine and passed the
// 5 s default only by luck on a loaded CI runner, so the default is raised for the whole package.
export default defineConfig({ test: { testTimeout: 20_000 } });
