import { access, cp, mkdir, rm, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nft from "next/dist/compiled/@vercel/nft/index.js";

export async function packageStandalone({
  webRoot = fileURLToPath(new URL("../", import.meta.url)),
  distDir = process.env.E2E_NEXT_DIST_DIR || ".next",
} = {}) {
  const standaloneRoot = resolve(webRoot, distDir, "standalone/packages/web");
  // Next traces server dependencies, but leaves browser assets outside standalone.
  await access(resolve(standaloneRoot, "server.js"));
  await cp(resolve(webRoot, distDir, "static"), resolve(standaloneRoot, distDir, "static"), { recursive: true });
  await cp(resolve(webRoot, "public"), resolve(standaloneRoot, "public"), { recursive: true });
  // The seed preparation process imports unbundled shared code. Next's route
  // trace sees the bundled version, so trace this entry and its dependencies too.
  const repositoryRoot = resolve(webRoot, "../..");
  const outputRoot = resolve(standaloneRoot, "../..");
  const entry = resolve(repositoryRoot, "packages/shared/dist/services/cube-seed-index.js");
  const { fileList } = await nft.nodeFileTrace([entry], { base: repositoryRoot, processCwd: webRoot });
  for (const file of fileList) {
    const target = resolve(outputRoot, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(repositoryRoot, file), target, { force: true, verbatimSymlinks: true });
  }
  const sharedLink = resolve(outputRoot, "node_modules/@yugidraft/shared");
  await mkdir(dirname(sharedLink), { recursive: true });
  await rm(sharedLink, { recursive: true, force: true });
  await symlink(relative(dirname(sharedLink), resolve(outputRoot, "packages/shared")), sharedLink, "dir");
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await packageStandalone();
