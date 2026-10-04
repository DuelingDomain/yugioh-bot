import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// DOMAIN_CORE_BUILD=docker (default): run packages/duel-server/scripts/build-domain-core.sh
// inside the pinned emscripten/emsdk image. DOMAIN_CORE_BUILD=local: run that same script on
// the host with DOMAIN_ROOT set; em++ must already be on PATH (source emsdk_env.sh first).
// There is no silent fallback between routes.
// DUEL_DATA_DIR overrides the resource bundle output (default $DOMAIN_ROOT/data/duel-engine).

const worktree = resolve(process.env.DOMAIN_ROOT ?? process.cwd());
// `tsx build-domain-core.ts legacy-domain` builds the Domain core of the old 1v1 engine (inputs in packages/duel-server/legacy-1v1).
const target = process.argv[2] ?? "domain";
if (target !== "domain" && target !== "standard" && target !== "legacy-domain" && target !== "multi-domain") throw new Error(`target must be "domain", "standard", "legacy-domain" or "multi-domain"`);
const pinsPath = resolve(worktree, target === "legacy-domain" ? "packages/duel-server/legacy-1v1/domain-core/pins.json" : "packages/duel-server/domain-core/pins.json");
if (!existsSync(pinsPath)) throw new Error(`missing ${pinsPath}`);
const pins = JSON.parse(readFileSync(pinsPath, "utf8")) as { emscripten?: { image?: string; digest?: string } };
const imageName = pins.emscripten?.image ?? "docker.io/emscripten/emsdk:4.0.9";
const image = pins.emscripten?.digest ? `${imageName}@${pins.emscripten.digest}` : imageName;
// `tsx build-domain-core.ts standard` builds the Standard core (stock rules plus the shared core fixes) instead.
const script = target === "legacy-domain" ? "packages/duel-server/legacy-1v1/scripts/build-domain-core.sh" : target === "multi-domain" ? "packages/duel-server/scripts/build-multi-core.sh" : `packages/duel-server/scripts/build-${target}-core.sh`;
const mode = process.env.DOMAIN_CORE_BUILD ?? "docker";
const dataDir = process.env.DUEL_DATA_DIR ? resolve(process.env.DUEL_DATA_DIR) : undefined;

if (!existsSync(resolve(worktree, script))) {
  throw new Error(`missing ${script} under ${worktree}`);
}
if (mode !== "docker" && mode !== "local") {
  throw new Error(`DOMAIN_CORE_BUILD must be "docker" or "local"`);
}
if (dataDir) mkdirSync(dataDir, { recursive: true });

const multiEnv = target === "multi-domain" ? { APPLY_DOMAIN: "1", DOMAIN_MULTI: "1", OUT_NAME: "ocgcore.multi-domain.sync.wasm" } : {};

const result =
  mode === "local"
    ? spawnSync("bash", [script], {
        stdio: "inherit",
        cwd: worktree,
        env: {
          ...process.env,
          ...multiEnv,
          DOMAIN_ROOT: worktree,
          ...(dataDir ? { DUEL_DATA_DIR: dataDir } : {}),
        },
      })
    : spawnSync(
        "docker",
        [
          "run",
          "--rm",
          ...(process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`] : []),
          "-v",
          `${worktree}:/src`,
          "-w",
          "/src",
          "-e",
          "DOMAIN_ROOT=/src",
          ...Object.entries(multiEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
          ...(process.env.LUA_FIXED_SEED ? ["-e", `LUA_FIXED_SEED=${process.env.LUA_FIXED_SEED}`] : []),
          ...(dataDir ? ["-v", `${dataDir}:/duel-data`, "-e", "DUEL_DATA_DIR=/duel-data"] : []),
          image,
          "bash",
          script,
        ],
        { stdio: "inherit" },
      );

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (target === "multi-domain" && dataDir) {
  copyFileSync(resolve(worktree, "packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm"), resolve(dataDir, "ocgcore.multi-domain.wasm"));
  copyFileSync(resolve(worktree, "packages/duel-server/domain-core/dist/ocgcore.multi-domain-build-info.json"), resolve(dataDir, "ocgcore.multi-domain-build-info.json"));
}
