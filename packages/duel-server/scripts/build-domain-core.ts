import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

// DOMAIN_CORE_BUILD=docker (default): run packages/duel-server/scripts/build-domain-core.sh
// inside the pinned emscripten/emsdk image. DOMAIN_CORE_BUILD=local: run that same script on
// the host with DOMAIN_ROOT set; em++ must already be on PATH (source emsdk_env.sh first).
// There is no silent fallback between routes.
// DUEL_DATA_DIR overrides the resource bundle output (default $DOMAIN_ROOT/data/duel-engine).

const worktree = resolve(process.env.DOMAIN_ROOT ?? process.cwd());
// `tsx build-domain-core.ts legacy-domain` builds the Domain core of the old 1v1 engine (inputs in packages/duel-server/legacy-1v1).
const target = process.argv[2] ?? "domain";
if (target !== "domain" && target !== "standard" && target !== "legacy-domain" && target !== "multi" && target !== "multi-domain") throw new Error(`target must be "domain", "standard", "legacy-domain", "multi" or "multi-domain"`);
const pinsPath = resolve(worktree, target === "legacy-domain" ? "packages/duel-server/legacy-1v1/domain-core/pins.json" : "packages/duel-server/domain-core/pins.json");
if (!existsSync(pinsPath)) throw new Error(`missing ${pinsPath}`);
const pins = JSON.parse(readFileSync(pinsPath, "utf8")) as { emscripten?: { image?: string; digest?: string } };
const imageName = pins.emscripten?.image ?? "docker.io/emscripten/emsdk:4.0.9";
const image = pins.emscripten?.digest ? `${imageName}@${pins.emscripten.digest}` : imageName;
// `tsx build-domain-core.ts standard` builds the Standard core (stock rules plus the shared core fixes) instead.
// Multiplayer builds can use a private output directory without replacing local artifacts.
const output = resolve(process.env.DOMAIN_CORE_OUTPUT ?? `${worktree}/packages/duel-server/domain-core/dist`);
const containerOutput = `/src/${relative(worktree, output)}`;
const multiplayer = target === "multi" || target === "multi-domain";
const script = multiplayer ? "packages/duel-server/scripts/build-multi-core.sh" : target === "legacy-domain" ? "packages/duel-server/legacy-1v1/scripts/build-domain-core.sh" : `packages/duel-server/scripts/build-${target}-core.sh`;
const mode = process.env.DOMAIN_CORE_BUILD ?? "docker";
const dataDir = process.env.DUEL_DATA_DIR ? resolve(process.env.DUEL_DATA_DIR) : undefined;

if (!existsSync(resolve(worktree, script))) {
  throw new Error(`missing ${script} under ${worktree}`);
}
if (mode !== "docker" && mode !== "local") {
  throw new Error(`DOMAIN_CORE_BUILD must be "docker" or "local"`);
}
if (dataDir) mkdirSync(dataDir, { recursive: true });

const result =
  mode === "local"
    ? spawnSync("bash", [script], {
        stdio: "inherit",
        cwd: worktree,
        env: {
          ...process.env,
          DOMAIN_ROOT: worktree,
          ...(dataDir ? { DUEL_DATA_DIR: dataDir } : {}),
        },
      })
    : spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--ulimit", "core=1:1",
          ...(process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`] : []),
          "-v",
          `${worktree}:/src`,
          "-w",
          "/src",
          "-e",
          "DOMAIN_ROOT=/src",
          ...(dataDir ? ["-v", `${dataDir}:/duel-data`, "-e", "DUEL_DATA_DIR=/duel-data"] : []),
          ...(multiplayer ? ["-e", "LUA_FIXED_SEED=1", "-e", `OUT_NAME=ocgcore.${target}.sync.wasm`,
            "-e", `MULTI_TREE=${containerOutput}/build-tree`,
            "-e", `DOMAIN_CORE_DIST=${containerOutput}`,
            ...(target === "multi-domain" ? ["-e", "APPLY_DOMAIN=1", "-e", "DOMAIN_MULTI=1"] : [])] : []),
          image,
          "bash", "-c",
          'export EMCC_CORES=4; export EM_CACHE=/src/packages/duel-server/domain-core/.build/emcache; export CI_REAL_EMXX="$(command -v em++)"; export PATH="/src/scripts/ci/bin:$PATH"; exec bash "$1"',
          "bash", script,
        ],
        { stdio: "inherit" },
      );

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
