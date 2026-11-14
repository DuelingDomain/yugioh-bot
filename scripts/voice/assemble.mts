/** Offline image assembly. CI supplies pinned models and cached KWS WASM; workers always come from this checkout. */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

if (process.argv.includes("--help")) {
  console.log("assemble.mts --from <CI asset directory> --out <vision-code directory>. Offline; requires all models and KWS WASM. Builds both workers and copies the installed ONNX Runtime.");
  process.exit(0);
}
function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`);
  return path.resolve(value);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const input = argument("--from");
const out = argument("--out");
const files = [
  "asr/model/encoder_model_quantized.onnx", "asr/model/decoder_model_merged_quantized.onnx",
  "asr/model/vocab.json", "asr/model/LICENSE.txt",
  "kws/model/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "kws/model/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "kws/model/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "kws/model/tokens.txt", "kws/model/LICENSE.txt",
  "kws/sherpa-kws.js", "kws/sherpa-kws.wasm", "kws/LICENSE.sherpa-onnx",
];
for (const file of files) {
  const bytes = await readFile(path.join(input, file));
  if (!bytes.length) throw new Error(`Empty voice asset: ${file}`);
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await copyFile(path.join(input, file), path.join(out, file));
}
// npm ci supplies exactly package-lock.json's runtime, also used by the worker bundle.
const installed = JSON.parse(await readFile(path.join(root, "node_modules/onnxruntime-web/package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
if (installed.version !== lock.packages["node_modules/onnxruntime-web"].version) throw new Error("ONNX Runtime differs from package-lock.json");
for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await copyFile(path.join(root, "node_modules/onnxruntime-web/dist", file), path.join(out, "asr", file));
}
for (const [source, dest] of [["onnxruntime.LICENSE", "LICENSE.onnxruntime.txt"], ["onnxruntime.ThirdPartyNotices.txt", "ThirdPartyNotices.onnxruntime.txt"]]) {
  await copyFile(path.join(root, "packages/vision/src/licenses", source), path.join(out, "asr", dest));
}
await copyFile(path.join(out, "kws/LICENSE.sherpa-onnx"), path.join(out, "kws/LICENSE"));
// sherpa's pinned CMake file statically links ONNX Runtime 1.28.2 into its WASM.
for (const [source, dest] of [["LICENSE.txt", "LICENSE.onnxruntime.txt"], ["ThirdPartyNotices.txt", "ThirdPartyNotices.onnxruntime.txt"]]) {
  await copyFile(path.join(root, `scripts/voice/licenses/onnxruntime-1.28.2.${source}`), path.join(out, "kws", dest));
}
for (const kind of ["asr", "kws"]) {
  await copyFile(path.join(root, "scripts/voice/NOTICE"), path.join(out, kind, "NOTICE"));
  await build({ entryPoints: [path.join(root, `packages/web/src/components/remote/ui/voice/${kind}-worker.ts`)], outfile: path.join(out, kind, "worker.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "eof" });
}
console.log(`Voice image assets ready in ${out} (ONNX Runtime ${installed.version})`);
