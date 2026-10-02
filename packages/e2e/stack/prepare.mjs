// Builds what the isolated stack runs, only when it is out of date.
//  - ws dist            (tsc, cheap)
//  - duel-server dist   (tsc; only if missing or older than its src)
//  - web standalone     (next build with the E2E NEXT_PUBLIC_WS_URL baked in)
// Set E2E_FORCE_BUILD=1 to rebuild all. Set E2E_SKIP_BUILD=1 to skip all builds.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStampFile, e2eRoot, e2eSlot, nextDistDir, repoRoot, standaloneBuildDir, wsUrl } from "./env.mjs";
import { isBuildFresh, newest, withBuildLock, withPreservedFiles } from "./build.mjs";

if (process.env.E2E_SKIP_BUILD === "1") process.exit(0);
const force = process.env.E2E_FORCE_BUILD === "1";

function sh(label, args, options = {}) {
  console.log(`[e2e:prepare] ${label}`);
  const result = spawnSync("npm", args, { cwd: repoRoot, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${label} failed`);
}

const at = (path) => resolve(repoRoot, path);
const serviceInputs = (name) => ["src", "package.json", "tsconfig.json", "tsconfig.build.json"].map((path) => at(`packages/${name}/${path}`)).concat(at("tsconfig.json"));
const sharedDist = at("packages/shared/dist/services/index.js");
if (!isBuildFresh(sharedDist, serviceInputs("shared"))) throw new Error('packages/shared/dist is missing or stale. Run "npm run build --workspace=packages/shared" once before starting parallel slots.');
console.log("[e2e:prepare] shared build is up to date");

for (const name of ["ws", "duel-server"]) {
  if (force || !isBuildFresh(at(`packages/${name}/dist/server.js`), [...serviceInputs(name), at("packages/shared/dist")])) {
    sh(`build ${name}`, ["run", "build", `--workspace=packages/${name}`]);
  } else console.log(`[e2e:prepare] ${name} build is up to date`);
}

const webInputs = ["app", "src", "public", "next.config.ts", "package.json", "scripts", "tsconfig.json"].map((path) => at(`packages/web/${path}`)).concat(at("packages/shared/dist"));
const prepareWeb = async () => {
  let stamped = { wsUrl: "", builtAt: 0 };
  try { stamped = JSON.parse(readFileSync(buildStampFile, "utf8")); } catch { /* No stamp: build. */ }
  if (force || !existsSync(resolve(standaloneBuildDir, "server.js")) || stamped.wsUrl !== wsUrl || stamped.builtAt < newest(webInputs)) {
    const build = () => sh(`build web (${nextDistDir}, production standalone)`, ["run", "build", "--workspace=packages/web"], {
        env: { ...process.env, E2E_NEXT_DIST_DIR: nextDistDir, NEXT_PUBLIC_WS_URL: wsUrl, NEXT_TELEMETRY_DISABLED: "1" },
      });
    if (e2eSlot === undefined) build();
    else await withPreservedFiles([at("packages/web/next-env.d.ts"), at("packages/web/tsconfig.json")], build);
    writeFileSync(buildStampFile, JSON.stringify({ wsUrl, builtAt: Date.now() }));
  } else console.log(`[e2e:prepare] web build ${nextDistDir} is up to date`);
};
await withBuildLock(resolve(e2eRoot, ".stack-build-lock"), prepareWeb);
