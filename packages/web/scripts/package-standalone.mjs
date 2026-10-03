import { access, cp } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function packageStandalone({
  webRoot = fileURLToPath(new URL("../", import.meta.url)),
  distDir = process.env.E2E_NEXT_DIST_DIR || ".next",
} = {}) {
  const standaloneRoot = resolve(webRoot, distDir, "standalone/packages/web");
  // Next traces server dependencies, but leaves browser assets outside standalone.
  await access(resolve(standaloneRoot, "server.js"));
  await cp(resolve(webRoot, distDir, "static"), resolve(standaloneRoot, distDir, "static"), { recursive: true });
  await cp(resolve(webRoot, "public"), resolve(standaloneRoot, "public"), { recursive: true });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await packageStandalone();
