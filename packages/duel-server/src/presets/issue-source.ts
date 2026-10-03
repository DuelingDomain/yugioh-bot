import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PresetIssue } from "./index.js";

const CACHE_MS = 10_000;

function presetIds(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof record.presetId === "string") out.push(record.presetId);
  if (Array.isArray(record.presetIds)) for (const id of record.presetIds) if (typeof id === "string") out.push(id);
  return out;
}

/**
 * Known issues per preset, read from the issue inbox (`.status/issues/<sig>.json`, written by scripts/lib/issue-registry.ts).
 * The inbox record has no preset link today (sig, owner, title, firstSeen, lastSeen, count, repro, source). An issue links to a
 * preset only when its file also has `presetId` (string) or `presetIds` (string list). Without that it is not shown.
 * The directory is read at most once every 10 s. It never throws: a bad file is skipped.
 */
export function createIssueSource(dir: string, now: () => number = Date.now): (presetId: string) => PresetIssue[] {
  let loadedAt = -Infinity;
  let byPreset = new Map<string, PresetIssue[]>();
  function load(): void {
    const next = new Map<string, PresetIssue[]>();
    try {
      if (existsSync(dir)) {
        for (const name of readdirSync(dir).sort()) {
          if (!name.endsWith(".json")) continue;
          try {
            const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
            if (!record || typeof record !== "object" || typeof record.sig !== "string") continue;
            const issue: PresetIssue = {
              sig: record.sig,
              title: typeof record.title === "string" ? record.title : "",
              owner: typeof record.owner === "string" ? record.owner : "",
            };
            for (const id of new Set(presetIds(record))) next.set(id, [...(next.get(id) ?? []), issue]);
          } catch {
            // skip a bad file
          }
        }
      }
    } catch {
      // unreadable directory: no issues
    }
    byPreset = next;
  }
  return (presetId) => {
    const t = now();
    if (t - loadedAt >= CACHE_MS) {
      loadedAt = t;
      load();
    }
    return byPreset.get(presetId) ?? [];
  };
}
