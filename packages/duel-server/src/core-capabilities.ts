import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CoreCapabilities {
  /** C6: living facing seats (0/1, 2/3) in FFA4 share the two Extra Monster Zones. */
  ffa4SharedExtraZones: boolean;
  /** Owner 2026-10-07: Tag facing seats (0/1, 2/3) share EMZ. */
  tagSharedExtraZones: boolean;
}

/** Read explicit capabilities only when the SOURCE hash identifies the binary loaded by this duel. */
export function readCoreCapabilities(dataDirectory: string, wasmFile: string, loadedSha: string): CoreCapabilities {
  let source: string;
  try {
    source = readFileSync(join(dataDirectory, wasmFile.replace(/\.wasm$/, ".SOURCE")), "utf8");
  } catch {
    return { ffa4SharedExtraZones: false, tagSharedExtraZones: false };
  }
  const fields = new Map(source.split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
  const capabilities = fields.get("capabilities")?.split(",").map((flag) => flag.trim()) ?? [];
  return {
    ffa4SharedExtraZones: fields.get("sha256") === loadedSha && capabilities.includes("ffa4-facing-extra-zones"),
    tagSharedExtraZones: fields.get("sha256") === loadedSha && capabilities.includes("tag-facing-extra-zones"),
  };
}
