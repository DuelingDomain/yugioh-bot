import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Which multi-duelist core a run uses. */
export interface CoreInfo {
  /** Short name: the tag of the build (B2, T3, ...), or the file name when there is no tag. */
  tag: string;
  path: string;
  sha256: string;
}

/** Default core: `data/duel-engine-next/ocgcore.multi.wasm` (its tag is in `ocgcore.multi.SOURCE`). */
export function defaultMultiWasmPath(dataDirectory: string): string {
  return join(dataDirectory, "ocgcore.multi.wasm");
}

export function distWasmPath(tag: string): string {
  return join(PACKAGE_DIR, "domain-core/dist", `ocgcore.multi-${tag}.sync.wasm`);
}

/** Tags of the per-task builds in `domain-core/dist` that exist now. */
export function existingDistTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => existsSync(distWasmPath(tag)));
}

/** `NSEAT_WASM` is a path, or a tag that names a dist build. Without it, the default core of the data directory. */
export function resolveCorePath(dataDirectory: string, spec: string | undefined = process.env.NSEAT_WASM): string {
  if (!spec) return defaultMultiWasmPath(dataDirectory);
  if (/^[A-Za-z0-9]+$/.test(spec) && !existsSync(spec) && existsSync(distWasmPath(spec))) return distWasmPath(spec);
  return resolve(spec);
}

export function readCore(path: string): { info: CoreInfo; bytes: ArrayBuffer } {
  if (!existsSync(path)) throw new Error(`Multi-duelist wasm not found: ${path}`);
  const file = readFileSync(path);
  const sha256 = createHash("sha256").update(file).digest("hex");
  let tag = "";
  const fromName = /^ocgcore\.multi-(.+)\.sync\.wasm$/.exec(basename(path));
  if (fromName) tag = fromName[1]!;
  else {
    const source = path.replace(/\.wasm$/, ".SOURCE");
    if (existsSync(source)) tag = /^tag=(.*)$/m.exec(readFileSync(source, "utf8"))?.[1]?.trim() ?? "";
  }
  return {
    info: { tag: tag || basename(path), path, sha256 },
    bytes: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  };
}
