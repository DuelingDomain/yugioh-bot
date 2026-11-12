import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  test: {
    // Component tests use jsdom; pure unit tests run in node by default.
    // Individual test files opt-in via `// @vitest-environment jsdom`.
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: [".next/**", "node_modules/**"],
    // Route tests reset modules and import the whole route tree per test. On a loaded 4-core CI
    // runner that cold transform passes the 5 s default in unrelated files; keep local runs strict.
    testTimeout: process.env.CI ? 20_000 : 5_000,
    hookTimeout: process.env.CI ? 30_000 : 10_000,
  },
  resolve: {
    // Dedupe ensures a single React instance across vitest + @testing-library.
    // The local packages/web/node_modules/react has been removed so only the
    // workspace-root copy (node_modules/react) exists.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
