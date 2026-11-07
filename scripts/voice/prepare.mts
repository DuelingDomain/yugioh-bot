/**
 * Local setup for the browser voice commands (never committed): the int8 KWS model, the KWS-only sherpa-onnx WebAssembly
 * module and the bundled speech worker, in data/vision/kws (served by /dev/vision-assets/kws/*, like the vision models).
 *
 *   npx tsx scripts/voice/prepare.mts            model + worker bundle (needs data/voice-build/out for the wasm)
 *   npx tsx scripts/voice/prepare.mts --wasm     also build the wasm first (Docker, pinned emsdk image)
 *   npx tsx scripts/voice/prepare.mts --vocab    rewrite the committed sp-vocab.json from the model's bpe.model
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(path.resolve(process.env.VISION_DATA_DIR ?? path.join(root, "data/vision")), "kws");
const pins = JSON.parse(await readFile(path.join(root, "scripts/voice/kws-pins.json"), "utf8")) as { model: { name: string; url: string } };
const vocabFile = path.join(root, "packages/web/src/components/remote/ui/voice/sp-vocab.json");
const modelFiles = ["encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "tokens.txt"];

/** Minimal protobuf read of ModelProto.pieces (field 1: piece = 1, score = 2). Enough for the vocabulary, nothing else. */
function readVocab(model: Buffer, tokens: string[]) {
  const pieces: string[] = []; const scores: number[] = [];
  let i = 0;
  const varint = () => { let v = 0, shift = 0; for (;;) { const b = model[i++]; v += (b & 0x7f) * 2 ** shift; if (!(b & 0x80)) return v; shift += 7; } };
  while (i < model.length) {
    const key = varint(); const field = key >> 3; const wire = key & 7;
    if (wire === 2) {
      const length = varint(); const end = i + length;
      if (field === 1) {
        let piece = ""; let score = 0;
        while (i < end) {
          const k = varint(); const f = k >> 3; const w = k & 7;
          if (w === 2) { const l = varint(); if (f === 1) piece = model.subarray(i, i + l).toString("utf8"); i += l; }
          else if (w === 5) { if (f === 2) score = model.readFloatLE(i); i += 4; }
          else if (w === 0) varint();
          else if (w === 1) i += 8;
        }
        pieces.push(piece); scores.push(Math.round(score * 1e6) / 1e6);
      }
      i = end;
    } else if (wire === 0) varint(); else if (wire === 5) i += 4; else if (wire === 1) i += 8; else throw new Error(`wire type ${wire}`);
  }
  if (pieces.length !== tokens.length || pieces.some((p, n) => p !== tokens[n])) throw new Error("bpe.model pieces do not match tokens.txt");
  return { pieces, scores, unk: pieces.indexOf("<unk>"), first: pieces.findIndex(p => !p.startsWith("<")) };
}

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
await mkdir(out, { recursive: true });
if (process.argv.includes("--wasm")) {
  const built = spawnSync(process.execPath, [...process.execArgv, path.join(root, "scripts/voice/build-kws-wasm.ts")], { stdio: "inherit", cwd: root });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const work = await mkdtemp(path.join(tmpdir(), "kws-model-"));
try {
  const archive = path.join(work, "model.tar.bz2");
  const response = await fetch(pins.model.url);
  if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status})`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync("tar", ["xjf", archive, "-C", work]);
  const dir = path.join(work, pins.model.name);
  await mkdir(path.join(out, "model"), { recursive: true });
  for (const file of modelFiles) await copyFile(path.join(dir, file), path.join(out, "model", file));
  const tokens = (await readFile(path.join(dir, "tokens.txt"), "utf8")).trim().split("\n").map(line => line.split(" ")[0]);
  const vocab = JSON.stringify(readVocab(await readFile(path.join(dir, "bpe.model")), tokens));
  if (process.argv.includes("--vocab")) await writeFile(vocabFile, `${vocab}\n`);
  else if (JSON.stringify(JSON.parse(await readFile(vocabFile, "utf8"))) !== vocab) throw new Error("sp-vocab.json differs from the model's bpe.model; run with --vocab");
  await writeFile(path.join(out, "model", "LICENSE.txt"), `${pins.model.name}\nApache License 2.0 (model README). https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models\n`);
  for (const file of modelFiles) console.log(`${file} sha256 ${sha(await readFile(path.join(out, "model", file))).slice(0, 16)}`);
} finally { await rm(work, { recursive: true, force: true }); }

const buildOut = path.join(root, "data/voice-build/out");
if (existsSync(buildOut)) {
  await copyFile(path.join(buildOut, "sherpa-onnx-wasm-kws-main.js"), path.join(out, "sherpa-kws.js"));
  await copyFile(path.join(buildOut, "sherpa-onnx-wasm-kws-main.wasm"), path.join(out, "sherpa-kws.wasm"));
  await copyFile(path.join(buildOut, "LICENSE.sherpa-onnx"), path.join(out, "LICENSE.sherpa-onnx"));
} else console.warn("No data/voice-build/out: run with --wasm to build the module.");
await build({ entryPoints: [path.join(root, "packages/web/src/components/remote/ui/voice/kws-worker.ts")], outfile: path.join(out, "worker.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none" });
console.log(`KWS voice assets ready in ${out}`);
