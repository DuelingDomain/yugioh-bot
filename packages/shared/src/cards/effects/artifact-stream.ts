import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

interface Integrity {
  path: string;
  bytes: number;
  sha256: string;
  gzipBytes: number;
  gzipSha256: string;
}

// Native zlib streams in an isolated short-lived process. stdout carries no
// artifact content; fd 3 is a private temporary file, never a buffered pipe.
const DECOMPRESS = `
  const fs = require('node:fs');
  const { createGunzip } = require('node:zlib');
  const { Transform } = require('node:stream');
  const { pipeline } = require('node:stream/promises');
  let bytes = 0;
  const limit = Number(process.argv[2]);
  pipeline(fs.createReadStream(process.argv[1]), createGunzip(), new Transform({
    transform(chunk, encoding, next) {
      bytes += chunk.length;
      next(bytes > limit ? new Error('Effect artifact exceeds pinned size') : null, chunk);
    }
  }), fs.createWriteStream('', { fd: 3, autoClose: false }))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
`;

/** The synchronous API spools a bounded native gzip stream to private temporary
 * storage. This avoids retaining allocator pages from decoding the full catalog
 * in the long-lived server; both processes use bounded buffers, never full files. */
export function streamArtifactFile(path: string, file: Integrity, consume: (chunk: Uint8Array) => void): void {
  const fd = openSync(path, "r");
  const input = Buffer.allocUnsafe(16 * 1024);
  let temporary: string | undefined, decoded: number | undefined;
  try {
    const compressedHash = createHash("sha256");
    let compressedBytes = 0;
    for (let size; (size = readSync(fd, input, 0, input.length, compressedBytes)) > 0;) {
      compressedHash.update(input.subarray(0, size));
      compressedBytes += size;
    }
    if (compressedBytes !== file.gzipBytes || compressedHash.digest("hex") !== file.gzipSha256) {
      throw new Error(`Effect artifact ${file.path} compressed hash does not match integrity`);
    }
    temporary = mkdtempSync(join(tmpdir(), "effect-artifact-stream-"));
    decoded = openSync(join(temporary, "decoded"), "w+", 0o600);
    const result = spawnSync(process.execPath, ["--input-type=commonjs", "-e", DECOMPRESS, path, String(file.bytes)], {
      stdio: ["ignore", "ignore", "pipe", decoded], encoding: "utf8", maxBuffer: 16 * 1024,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    if (result.error || result.status !== 0) throw new Error(`Effect artifact ${file.path} gzip integrity failed: ${result.error?.message ?? result.stderr}`);
    const hash = createHash("sha256");
    let bytes = 0;
    for (let size; (size = readSync(decoded, input, 0, input.length, bytes)) > 0;) {
      bytes += size;
      if (bytes > file.bytes) throw new Error(`Effect artifact ${file.path} exceeds its pinned size`);
      const chunk = input.subarray(0, size);
      hash.update(chunk); consume(chunk);
    }
    if (bytes !== file.bytes || hash.digest("hex") !== file.sha256) {
      throw new Error(`Effect artifact ${file.path} content hash does not match integrity`);
    }
  } finally {
    closeSync(fd);
    if (decoded !== undefined) closeSync(decoded);
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

/** The only retained text is one incomplete record and the current chunk. */
export function streamArtifactLines(path: string, file: Integrity & { records: number }, consume: (line: string, index: number) => void): void {
  const decoder = new StringDecoder("utf8");
  let pending = "", records = 0;
  const accept = (text: string) => {
    pending += text;
    let start = 0, end: number;
    while ((end = pending.indexOf("\n", start)) >= 0) {
      const line = pending.slice(start, end).trim();
      if (line) consume(line, records++);
      start = end + 1;
    }
    pending = pending.slice(start);
  };
  streamArtifactFile(path, file, chunk => accept(decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))));
  accept(decoder.end());
  if (pending.trim()) consume(pending.trim(), records++);
  if (records !== file.records) throw new Error(`Effect artifact ${file.path} record count does not match integrity`);
}

/** Release metadata is a JSON array of objects. Split only at top-level object
 * boundaries, respecting quoted braces and escapes; keep one record at a time. */
export function streamArtifactArray(path: string, file: Integrity & { records: number }, consume: (value: unknown) => void): void {
  const decoder = new StringDecoder("utf8");
  let record = "", depth = 0, quoted = false, escaped = false, opened = false, closed = false, records = 0;
  const accept = (text: string) => {
    let start = depth ? 0 : -1;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (!depth) {
        if (/\s/.test(char)) continue;
        if (!opened && char === "[") { opened = true; continue; }
        if (opened && !closed && char === "]") { closed = true; continue; }
        if (opened && !closed && char === ",") continue;
        if (!opened || closed || char !== "{") throw new Error("Invalid release artifact array");
        start = index; depth = 1;
      } else if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        if (--depth === 0) {
          record += text.slice(start, index + 1);
          consume(JSON.parse(record)); records++;
          record = ""; start = -1;
        }
      }
    }
    if (start >= 0) record += text.slice(start);
  };
  streamArtifactFile(path, file, chunk => accept(decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))));
  accept(decoder.end());
  if (!opened || !closed || depth || records !== file.records) throw new Error("Invalid release artifact count");
}
