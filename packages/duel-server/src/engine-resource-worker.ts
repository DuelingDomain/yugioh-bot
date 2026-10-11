import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { getCurrentEngineResources, type EngineResources, type ResourceOptions } from "./engine-resource-resolver.js";

const cache = new Map<string, { stamp: string; resources: EngineResources }>();
let hashCount = 0;
/** Metadata validation catches in-place edits, nested additions, removals and bundle replacements. */
function resourceStamp(roots: string[]): string {
  const hash = createHash("sha256");
  const visit = (path: string) => {
    const file = lstatSync(path);
    if (file.isSymbolicLink()) throw new Error("Non-regular resource");
    hash.update(JSON.stringify([path, file.ino, file.size, file.mtimeMs, file.ctimeMs]));
    if (file.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child));
  };
  for (const root of roots) {
    hash.update(root);
    if (existsSync(root)) visit(realpathSync(root));
    else hash.update("missing");
  }
  return hash.digest("hex");
}
parentPort!.on("message", ({ id, key, directory, options, roots }: { id: number; key: string; directory: string; options: ResourceOptions; roots: string[] }) => {
  try {
    // Both metadata walks and full hashing stay off the host event loop.
    const stamp = resourceStamp(roots);
    const cached = cache.get(key);
    if (cached?.stamp === stamp) parentPort!.postMessage({ id, key, stamp, hashCount });
    else {
      const resources = getCurrentEngineResources(directory, options); hashCount++;
      cache.set(key, { stamp, resources });
      parentPort!.postMessage({ id, key, stamp, resources, hashCount });
    }
  } catch { cache.delete(key); parentPort!.postMessage({ id, error: true }); }
});
