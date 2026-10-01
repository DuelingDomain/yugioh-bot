// Builds what the isolated stack runs, only when it is out of date.
//  - ws dist            (tsc, cheap)
//  - duel-server dist   (tsc; only if missing or older than its src)
//  - web standalone     (next build with the E2E NEXT_PUBLIC_WS_URL baked in)
// Set E2E_FORCE_BUILD=1 to rebuild all. Set E2E_SKIP_BUILD=1 to skip all builds.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot, wsUrl } from "./env.mjs";

if (process.env.E2E_SKIP_BUILD === "1") process.exit(0);
const force = process.env.E2E_FORCE_BUILD === "1";

function newest(paths) {
  let latest = 0;
  const walk = (path) => {
    if (!existsSync(path)) return;
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const entry of readdirSync(path)) if (entry !== "node_modules" && !entry.startsWith(".next")) walk(resolve(path, entry));
    } else latest = Math.max(latest, info.mtimeMs);
  };
  paths.forEach(walk);
  return latest;
}
function oldest(file) {
  return existsSync(file) ? statSync(file).mtimeMs : 0;
}
function sh(label, args, options = {}) {
  console.log(`[e2e:prepare] ${label}`);
  const result = spawnSync("npm", args, { cwd: repoRoot, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${label} failed`);
}

const at = (path) => resolve(repoRoot, path);
const sharedDist = at("packages/shared/dist/services/index.js");
if (!existsSync(sharedDist)) throw new Error('packages/shared/dist is missing. Run "npm run build --workspace=packages/shared" once.');

if (force || oldest(at("packages/ws/dist/server.js")) < newest([at("packages/ws/src")])) {
  sh("build ws", ["run", "build", "--workspace=packages/ws"]);
}
if (force || oldest(at("packages/duel-server/dist/server.js")) < newest([at("packages/duel-server/src")])) {
  sh("build duel-server", ["run", "build", "--workspace=packages/duel-server"]);
}

const stamp = at("packages/web/.next/standalone/packages/web/.e2e-build.json");
let stamped = { wsUrl: "", builtAt: 0 };
try {
  stamped = JSON.parse(readFileSync(stamp, "utf8"));
} catch {
  // No stamp: build.
}
const webInputs = [at("packages/web/app"), at("packages/web/src"), at("packages/web/public"), at("packages/web/next.config.ts"), at("packages/shared/dist")];
if (force || stamped.wsUrl !== wsUrl || stamped.builtAt < newest(webInputs)) {
  sh("build web (production standalone)", ["run", "build", "--workspace=packages/web"], {
    env: { ...process.env, NEXT_PUBLIC_WS_URL: wsUrl, NEXT_TELEMETRY_DISABLED: "1" },
  });
  writeFileSync(stamp, JSON.stringify({ wsUrl, builtAt: Date.now() }));
} else {
  console.log("[e2e:prepare] web build is up to date");
}
