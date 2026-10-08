import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const names = new Map<string, string>();

/** The pinned wrapper's sync glue binds API names to minified WASM exports. */
export function findSyncWasmExport(api: "_ocgapiDuelGetMessage" | "_ocgapiLoadScript"): string {
  const cached = names.get(api);
  if (cached) return cached;
  const dist = dirname(fileURLToPath(import.meta.resolve("ocgcore-wasm")));
  for (const file of readdirSync(dist)) {
    if (!file.startsWith("ocgcore.sync-") || !file.endsWith(".js")) continue;
    const match = new RegExp(`${api}=\\w+\\.(\\w+)`).exec(readFileSync(join(dist, file), "utf8"));
    if (match) { names.set(api, match[1]!); return match[1]!; }
  }
  throw new Error(`No sync glue in ${dist} binds ${api}`);
}
