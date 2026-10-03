// Builds what the isolated stack runs, only when it is out of date.
//  - ws dist            (tsc, cheap)
//  - duel-server dist   (tsc; only if missing or older than its src)
//  - web standalone     (next build with the E2E NEXT_PUBLIC_WS_URL baked in)
// Set E2E_FORCE_BUILD=1 to rebuild all. Set E2E_SKIP_BUILD=1 to skip all builds.
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStampFile, e2eRoot, e2eSlot, nextDistDir, repoRoot, standaloneBuildDir, wsUrl } from "./env.mjs";
import { isBuildFresh, newest, withBuildLock, withPreservedFiles } from "./build.mjs";

if (process.env.E2E_SKIP_BUILD === "1") process.exit(0);
const force = process.env.E2E_FORCE_BUILD === "1";

const cancellation = new AbortController();
let interrupted;
let activeBuild;
let killTimer;
const grouped = process.platform !== "win32";
function killBuild(signal) {
  if (!activeBuild) return;
  try {
    // npm launches a shell and Next/tsc: forward to the whole build process group.
    if (grouped) process.kill(-activeBuild.pid, signal);
    else activeBuild.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
function interrupt(signal) {
  interrupted ??= signal;
  cancellation.abort(new Error(`Build interrupted by ${signal}`));
  killBuild(signal);
  killTimer ??= setTimeout(() => killBuild("SIGKILL"), 4000);
  killTimer.unref();
}
const onInt = () => interrupt("SIGINT");
const onTerm = () => interrupt("SIGTERM");
process.on("SIGINT", onInt);
process.on("SIGTERM", onTerm);

async function sh(label, args, options = {}) {
  cancellation.signal.throwIfAborted();
  console.log(`[e2e:prepare] ${label}`);
  activeBuild = spawn("npm", args, { cwd: repoRoot, stdio: "inherit", detached: grouped, ...options });
  try {
    const code = await new Promise((done, fail) => {
      activeBuild.once("error", fail);
      activeBuild.once("close", done);
    });
    cancellation.signal.throwIfAborted();
    if (code !== 0) throw new Error(`${label} failed`);
  } finally {
    // npm can exit before its descendants. Stop any stragglers before restoring files.
    if (interrupted) killBuild("SIGKILL");
    clearTimeout(killTimer);
    killTimer = undefined;
    activeBuild = undefined;
  }
}

try {
const at = (path) => resolve(repoRoot, path);
const serviceInputs = (name) => ["src", "package.json", "tsconfig.json", "tsconfig.build.json"].map((path) => at(`packages/${name}/${path}`)).concat(at("tsconfig.json"));
const sharedDist = at("packages/shared/dist/services/index.js");
if (!isBuildFresh(sharedDist, serviceInputs("shared"))) throw new Error('packages/shared/dist is missing or stale. Run "npm run build --workspace=packages/shared" once before starting parallel slots.');
console.log("[e2e:prepare] shared build is up to date");

for (const name of ["ws", "duel-server"]) {
  if (force || !isBuildFresh(at(`packages/${name}/dist/server.js`), [...serviceInputs(name), at("packages/shared/dist")])) {
    await sh(`build ${name}`, ["run", "build", `--workspace=packages/${name}`]);
  } else console.log(`[e2e:prepare] ${name} build is up to date`);
}

const webInputs = ["app", "src", "public", "next.config.ts", "package.json", "scripts", "tsconfig.json"].map((path) => at(`packages/web/${path}`)).concat(at("packages/shared/dist"));
const prepareWeb = async () => {
  let stamped = { wsUrl: "", builtAt: 0 };
  try { stamped = JSON.parse(readFileSync(buildStampFile, "utf8")); } catch { /* No stamp: build. */ }
  if (force || !existsSync(resolve(standaloneBuildDir, "server.js")) || stamped.wsUrl !== wsUrl || stamped.builtAt < newest(webInputs)) {
    // Turbopack refuses dependency symlinks outside its filesystem root. Webpack supports borrowed
    // dependencies in isolated worktrees without widening the root into another worker's checkout.
    const borrowedDependencies = e2eSlot !== undefined && [at("node_modules"), at("packages/web/node_modules")]
      .some((path) => existsSync(path) && lstatSync(path).isSymbolicLink());
    const build = async () => {
      const options = { env: { ...process.env, E2E_NEXT_DIST_DIR: nextDistDir, NEXT_PUBLIC_WS_URL: wsUrl, NEXT_TELEMETRY_DISABLED: "1" } };
      if (borrowedDependencies) {
        await sh(`build web (${nextDistDir}, webpack with symlinked dependencies)`, ["exec", "--workspace=packages/web", "--", "next", "build", "--webpack"], options);
        await sh("package web standalone", ["run", "package:standalone", "--workspace=packages/web"], options);
      } else await sh(`build web (${nextDistDir}, production standalone)`, ["run", "build", "--workspace=packages/web"], options);
    };
    if (e2eSlot === undefined) await build();
    else await withPreservedFiles([at("packages/web/next-env.d.ts"), at("packages/web/tsconfig.json")], build);
    writeFileSync(buildStampFile, JSON.stringify({ wsUrl, builtAt: Date.now() }));
  } else console.log(`[e2e:prepare] web build ${nextDistDir} is up to date`);
};
await withBuildLock(resolve(e2eRoot, ".stack-build-lock"), prepareWeb, { signal: cancellation.signal });
} catch (error) {
  if (!interrupted) throw error;
  process.exitCode = interrupted === "SIGINT" ? 130 : 143;
} finally {
  clearTimeout(killTimer);
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
}
