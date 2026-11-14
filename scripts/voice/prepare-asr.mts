/**
 * Local setup for Method B of the voice check (never committed): Moonshine Tiny q8 (onnx-community/moonshine-tiny-ONNX, MIT),
 * the onnxruntime-web WASM files and the bundled speech worker, in data/vision/asr (served by /dev/vision-assets/asr/*).
 *
 *   npx tsx scripts/voice/prepare-asr.mts                 download the model from Hugging Face
 *   npx tsx scripts/voice/prepare-asr.mts --from <dir>    copy it from a folder that has onnx/ and tokenizer.json
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (process.argv.includes("--help")) {
  console.log("prepare-asr.mts [--from <verified model directory>] [--models-only]. Use prepare-voice-models.mts for pinned downloads.");
  process.exit(0);
}
const out = path.join(path.resolve(process.env.VISION_DATA_DIR ?? path.join(root, "data/vision")), "asr");
const REPO = "https://huggingface.co/onnx-community/moonshine-tiny-ONNX/resolve/main/";
const from = process.argv.includes("--from") ? path.resolve(process.argv[process.argv.indexOf("--from") + 1]) : "";
const models = ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];

const fetchBytes = async (file: string) => {
  if (from) return readFile(path.join(from, file));
  const response = await fetch(REPO + file);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

await mkdir(path.join(out, "model"), { recursive: true });
for (const file of models) await writeFile(path.join(out, "model", path.basename(file)), await fetchBytes(file));
// Token id -> piece, for the greedy decoder (special tokens stay empty).
const tokenizer = JSON.parse((await fetchBytes("tokenizer.json")).toString("utf8")) as { model: { vocab: Record<string, number> }; added_tokens: { id: number }[] };
const size = Math.max(...Object.values(tokenizer.model.vocab), ...tokenizer.added_tokens.map(token => token.id)) + 1;
const vocab: string[] = Array.from({ length: size }, () => "");
for (const [piece, id] of Object.entries(tokenizer.model.vocab)) vocab[id] = piece;
for (const token of tokenizer.added_tokens) vocab[token.id] = "";
vocab[0] = ""; vocab[1] = ""; vocab[2] = "";
await writeFile(path.join(out, "model", "vocab.json"), JSON.stringify(vocab));
await copyFile(path.join(root, "scripts/voice/licenses/moonshine.LICENSE.txt"), path.join(out, "model", "LICENSE.txt"));
if (process.argv.includes("--models-only")) process.exit(0);
const ortDist = path.join(root, "node_modules/onnxruntime-web/dist");
for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) await copyFile(path.join(ortDist, file), path.join(out, file));
for (const [source, dest] of [["onnxruntime.LICENSE", "LICENSE.onnxruntime.txt"], ["onnxruntime.ThirdPartyNotices.txt", "ThirdPartyNotices.onnxruntime.txt"]]) {
  await copyFile(path.join(root, "packages/vision/src/licenses", source), path.join(out, dest));
}
await copyFile(path.join(root, "scripts/voice/NOTICE"), path.join(out, "NOTICE"));
const { build } = await import("esbuild");
await build({ entryPoints: [path.join(root, "packages/web/src/components/remote/ui/voice/asr-worker.ts")], outfile: path.join(out, "worker.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none" });
console.log(`Speech model assets ready in ${out}`);
