import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export function createImageCacheCleanup({ imageCacheDir }: { imageCacheDir: string }) {
  async function files() {
    let entries;
    try {
      entries = await readdir(imageCacheDir, { withFileTypes: true });
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const result: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(imageCacheDir, entry.name);
      try {
        const info = await stat(path);
        result.push({ path, size: info.size, mtimeMs: info.mtimeMs });
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return result;
  }

  return {
    async imageCacheBytes() {
      return (await files()).reduce((bytes, file) => bytes + file.size, 0);
    },
    async removeOldestImages(maxBytes: number) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Invalid cache byte limit");
      const all = (await files()).sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
      let bytes = all.reduce((total, file) => total + file.size, 0);
      let removed = 0;
      for (const file of all) {
        if (bytes <= maxBytes) break;
        try {
          await unlink(file.path);
          removed++;
        } catch (error) {
          if (!missing(error)) throw error;
        }
        bytes -= file.size;
      }
      return removed;
    },
  };
}
