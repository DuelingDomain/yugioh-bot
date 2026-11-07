import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Builds the KWS-only sherpa-onnx WebAssembly module in the pinned emscripten image, the same image
// packages/duel-server/scripts/build-domain-core.ts uses (digest from domain-core/pins.json).
// Output: data/voice-build/out/ (gitignored). `prepare.mts --wasm` runs this and copies the result into data/vision/kws.
// Nothing here touches the stt image or its containers.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pins = JSON.parse(readFileSync(resolve(root, "packages/duel-server/domain-core/pins.json"), "utf8")) as { emscripten?: { image?: string; digest?: string } };
const imageName = pins.emscripten?.image ?? "docker.io/emscripten/emsdk:4.0.9";
const image = pins.emscripten?.digest ? `${imageName}@${pins.emscripten.digest}` : imageName;
const script = "scripts/voice/build-kws-wasm.sh";
if (!existsSync(resolve(root, script))) throw new Error(`missing ${script}`);
mkdirSync(resolve(root, "data/voice-build/.emcache"), { recursive: true });

const result = spawnSync("docker", [
  "run", "--rm",
  "--ulimit", "core=0:0",
  ...(process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`] : []),
  "-v", `${root}:/src`,
  "-w", "/src",
  "-e", "HOME=/tmp",
  "-e", "EM_CACHE=/src/data/voice-build/.emcache",
  "-e", "DOMAIN_ROOT=/src",
  "-e", `EMCC_CORES=${process.env.EMCC_CORES ?? "4"}`,
  image, "bash", script,
], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
