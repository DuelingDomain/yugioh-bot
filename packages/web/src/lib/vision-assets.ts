import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pinnedVisionIndexDirectory, visionCodeDirectory, visionDataDirectory } from "@yugidraft/shared/vision-assets";

/**
 * Where the web image keeps the recognition worker and the ONNX Runtime files (see the vision-code stage in the
 * Dockerfile). Current models stay in VISION_DATA_DIR. A pinned Current index ships beside this directory.
 * Pinned voice and Hybrid data ship with the image under asr/, kws/ and hybrid/.
 */
export { VISION_CODE_DIR_DEFAULT } from "@yugidraft/shared/vision-assets";
const indexFiles = new Set(["yugioh-index.bin", "yugioh-index.meta.json", "yugioh-index.build.json", "related-cards.json"]);

/** Image assets are versioned with the web bundle. */
export function isVisionCodeAsset(path: string[]): boolean {
  return (path.length === 1 && (path[0] === "worker.js" || path[0] === "NOTICE")) || (path.length > 1 && ["ort", "asr", "kws", "hybrid"].includes(path[0]));
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
    if (inside(resolve(root, "hybrid-sources"), target)) return undefined;
    // Prevent alternate paths from bypassing the Hybrid route's allow list.
    if ((path[0] === "hybrid") !== inside(resolve(root, "hybrid"), target)) return undefined;
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
 * has no such file (local development, where only data/vision exists) the data directory answers.
 * The pinned voice and Hybrid data also prefer the image.
 */
export async function openVisionAsset(path: string[]): Promise<VisionAsset | undefined> {
  if (path.length === 1 && indexFiles.has(path[0])) {
    const directory = pinnedVisionIndexDirectory();
    if (directory) {
      const found = await openInside(directory, path);
      return found && { ...found, code: true };
    }
  }
  if (isVisionCodeAsset(path)) {
    const found = await openInside(visionCodeDirectory(), path);
    if (found) return { ...found, code: true };
  }
  const found = await openInside(visionDataDirectory(), path);
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
