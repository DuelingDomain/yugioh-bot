/**
 * One command for a fresh PC: the speech model for /dev/voice-check (Moonshine Tiny q8), pinned to one Hugging Face
 * revision with a SHA-256 check on every file, then the same prepare-asr step that bundles the worker and the ONNX runtime.
 * Output goes to data/vision/asr (or VISION_DATA_DIR/asr). Nothing large is committed.
 *
 *   npx tsx scripts/voice/prepare-voice-models.mts          speech model (the default method of /dev/voice-check)
 *   npx tsx scripts/voice/prepare-voice-models.mts --kws    also the old keyword model (its WebAssembly module still
 *                                                          needs Docker: add --wasm, see prepare.mts)
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REVISION = "a6da1241cd305dcd64eab1edbd615f2bb9aabb95";
const BASE = `https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/${REVISION}/`;
const FILES: Record<string, string> = {
  "onnx/encoder_model_quantized.onnx": "c6fc4b7bc5af75c0591fd157a1f3829b533d18e9769a888fd95a62e470dd4f4a",
  "onnx/decoder_model_merged_quantized.onnx": "eed87831c3a6103534aae7d47a5d485025c659a1323901513961c39fe8a1a367",
  "tokenizer.json": "7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f",
};

function run(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [...process.execArgv, path.join(root, "scripts/voice", script), ...args], { stdio: "inherit", cwd: root });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const work = await mkdtemp(path.join(tmpdir(), "voice-models-"));
try {
  for (const [file, expected] of Object.entries(FILES)) {
    const response = await fetch(BASE + file);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(data).digest("hex");
    if (actual !== expected) throw new Error(`${file}: SHA-256 is ${actual}, expected ${expected}`);
    await mkdir(path.dirname(path.join(work, file)), { recursive: true });
    await writeFile(path.join(work, file), data);
    console.log(`ok ${file}`);
  }
  run("prepare-asr.mts", ["--from", work]);
} finally { await rm(work, { recursive: true, force: true }); }
if (process.argv.includes("--kws")) run("prepare.mts", process.argv.includes("--wasm") ? ["--wasm"] : []);
