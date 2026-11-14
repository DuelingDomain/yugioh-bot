import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Where the web image keeps the recognition worker and the ONNX Runtime files (see the vision-code stage in the
 * Dockerfile). Card-recognition models and indexes stay in VISION_DATA_DIR;
 * the pinned voice models and runtimes ship together under asr/ and kws/.
 */
export const VISION_CODE_DIR_DEFAULT = "/app/vision-code";

/** Image assets must match the web bundle. Voice subtrees include their pinned models and licences. */
export function isVisionCodeAsset(path: string[]): boolean {
  return (path.length === 1 && (path[0] === "worker.js" || path[0] === "NOTICE")) || (path.length > 1 && ["ort", "asr", "kws"].includes(path[0]));
}

export interface VisionAsset {
  file: FileHandle;
  stat: Stats;
  /** Served from the image's code directory (content-hash ETag, always revalidated) rather than the data volume. */
  code: boolean;
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Next runs with packages/web as cwd; an explicit directory may be absolute or relative to it. */
function dataDir() { return resolve(process.cwd(), process.env.VISION_DATA_DIR || "../../data/vision"); }
function codeDir() { return resolve(process.cwd(), process.env.VISION_CODE_DIR || VISION_CODE_DIR_DEFAULT); }

/** Opens one regular file that really lives inside `directory`, or returns undefined. Never throws. */
async function openInside(directory: string, path: string[]): Promise<{ file: FileHandle; stat: Stats } | undefined> {
  let file: FileHandle | undefined;
  try {
    const root = await realpath(directory);
    const candidate = resolve(root, ...path);
    if (!inside(root, candidate)) return undefined;
    const target = await realpath(candidate);
    if (!inside(root, target)) return undefined;
    // Owner diagnostic crops share DATA, but are never public model/lab assets.
    if (inside(resolve(root, "diagnostics"), target)) return undefined;
    // Refuse a final-component symlink introduced between realpath and open, too.
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (stat.isFile()) return { file, stat };
    await file.close();
    return undefined;
  } catch {
    await file?.close().catch(() => {});
    return undefined;
  }
}

/**
 * Code files come from the image first, so a deploy updates them with the web bundle that loads them. When the image
 * has no such file (local development, where only data/vision exists) the data directory answers. Data files never
 * read from the code directory, except the pinned voice models in asr/ and kws/.
 */
export async function openVisionAsset(path: string[]): Promise<VisionAsset | undefined> {
  if (isVisionCodeAsset(path)) {
    const found = await openInside(codeDir(), path);
    if (found) return { ...found, code: true };
  }
  const found = await openInside(dataDir(), path);
  return found && { ...found, code: false };
}

/** Data files: size and mtime, as the manual copy keeps mtimes. */
export function statEtag(stat: Stats): string {
  return `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
}

// An image is immutable, so each code file is hashed once per process. The key includes size, mtime and ctime (which
// utimes cannot set back) so a rewritten file in development is hashed again.
const contentHashes = new Map<string, Promise<string>>();

/**
 * Code files: a strong ETag from the contents. The image build sets every mtime to the epoch so unchanged layers keep
 * their digest, which makes size+mtime useless here.
 */
export function contentEtag(asset: VisionAsset): Promise<string> {
  const { dev, ino, size, mtimeMs, ctimeMs } = asset.stat;
  const key = `${dev}:${ino}:${size}:${mtimeMs}:${ctimeMs}`;
  let hash = contentHashes.get(key);
  if (!hash) {
    hash = (async () => {
      const digest = createHash("sha256");
      // Explicit start reads by position, so the same handle can still be streamed to the client afterwards.
      for await (const chunk of asset.file.createReadStream({ start: 0, autoClose: false, highWaterMark: 1 << 20 })) digest.update(chunk);
      return `"${digest.digest("hex").slice(0, 32)}"`;
    })();
    contentHashes.set(key, hash);
    hash.catch(() => contentHashes.delete(key));
  }
  return hash;
}

/** If-None-Match uses weak comparison: a proxy that compresses may turn a strong ETag into W/"...". */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some(tag => { const value = tag.trim(); return value === "*" || value.replace(/^W\//, "") === etag; });
}
