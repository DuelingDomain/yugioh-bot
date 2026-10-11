import { sharedSourceAliases } from "../shared/tests/helpers/source-aliases.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    conditions: ["source", "node"],
    alias: {
      ...sharedSourceAliases,
      "@yugidraft/shared/ws": resolve(root, "../shared/src/ws/index.ts"),
    },
  },
});
