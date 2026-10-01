/**
 * One known-issues registry, and the issue inbox `.status/issues/<sig>.json`.
 *
 * Two sources of known classes:
 *  - FZ's `tests/fuzz-n/known-issues.ts` (`KNOWN_ISSUES`, imported read-only; it matches an `NFailure`),
 *  - `LOCAL_ISSUES` below (they match a `FailureInfo`, the shape triage builds for any input type).
 * FZ's `KnownIssue.match(failure, context)` (fields sig, owner, title) needs an `NFailure` (invariant, message, step, seat, prompt, detail, pending).
 * `failureInfoToN` builds one from a FailureInfo, so the FZ entries work on every input that has an invariant.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_ISSUES, type KnownIssueContext } from "../../tests/fuzz-n/known-issues.js";
import type { NFailure } from "../../tests/fuzz-n/driver.js";
import { ownerOf, siteFromText, UNOWNED, type OwnerRow, type Site } from "./owners.js";

/** What triage knows about a failure, whatever the input type. */
export interface FailureInfo {
  /** The input type of triage (fuzz, fuzz-n, journal, stall, nduel, manual ...). */
  source: string;
  format?: string;
  /** Invariant or check name ("hang", "differential", "trap"). */
  invariant?: string;
  message?: string;
  /** Core tag (B2, T3 ...) or wasm file name. */
  coreTag?: string;
  /** A core site (trap line, sanitizer line, census row). */
  site?: Site;
  /** The pending action at the failure, when known. */
  pendingSeat?: number;
  pendingKind?: string;
  detail?: unknown;
  /** Text that identifies the class (used for the signature when there is no site). */
  text?: string;
  /** The preset the duel started from, when the input records it. */
  presetId?: string;
}

export interface LocalIssue {
  id: string;
  owner: string;
  summary: string;
  matches(info: FailureInfo): boolean;
}

/** Entries of this registry. Add a class here when it is not an `NFailure` class of FZ. */
export const LOCAL_ISSUES: LocalIssue[] = [
  {
    id: "b2-phase-event-trap",
    owner: "T3",
    summary: "B2 core: PhaseEvent asks opponent_of(turn player) with more than two duelists (trap at processor.cpp PhaseEvent).",
    matches: (info) => info.site?.file === "processor.cpp" && info.site.line !== undefined && info.site.line >= 295 && info.site.line <= 500 && /trap|opponent_of/i.test(`${info.message ?? ""} ${info.text ?? ""}`),
  },
  {
    id: "b2-sentinel-seat2",
    owner: "T9",
    summary: "B2 core: PLAYER_NONE (2) and PLAYER_ALL (3) are sentinels, so seat 2 and 3 cards act as if they had no controller.",
    matches: (info) => /PLAYER_NONE|PLAYER_ALL|sentinel/i.test(`${info.message ?? ""} ${info.text ?? ""}`),
  },
];

export interface Classification {
  id: string;
  owner: string;
  summary: string;
  registry: "fuzz-n" | "local";
}

export function failureInfoToN(info: FailureInfo): NFailure {
  return {
    invariant: info.invariant ?? "",
    message: info.message ?? "",
    step: 0,
    ...(info.pendingSeat === undefined ? {} : { seat: info.pendingSeat }),
    ...(info.detail === undefined ? {} : { detail: info.detail }),
    ...(info.pendingSeat === undefined ? {} : { pending: { kind: (info.pendingKind === "eliminate" ? "eliminate" : "answer") as "answer", seat: info.pendingSeat, promptId: "", revision: 0, answer: {} as never } }),
  };
}

/** The known class of a failure, or null when it is new. FZ entries first, then local ones. */
export function classifyKnown(info: FailureInfo): Classification | null {
  if (info.invariant) {
    const context: KnownIssueContext = { format: info.format ?? "", coreTag: info.coreTag ?? "" };
    const n = failureInfoToN(info);
    for (const issue of KNOWN_ISSUES) {
      let hit = false;
      try {
        hit = issue.match(n, context);
      } catch {
        hit = false;
      }
      if (hit) return { id: issue.sig, owner: issue.owner, summary: issue.title, registry: "fuzz-n" };
    }
  }
  for (const issue of LOCAL_ISSUES) if (issue.matches(info)) return { id: issue.id, owner: issue.owner, summary: issue.summary, registry: "local" };
  return null;
}

/** A stable 12 hex signature: the same failure class gives the same value. Digits in free text are dropped (steps, seeds, times). */
export function signatureOf(info: FailureInfo): string {
  const site = info.site ? `${info.site.file}:${info.site.fn ?? info.site.line ?? ""}` : "";
  const text = site ? "" : (info.message ?? info.text ?? "").replace(/\d+/g, "#").slice(0, 200);
  const key = [info.invariant ?? "", info.format ?? "", info.coreTag ?? "", site, text].join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

export interface IssueRecord {
  sig: string;
  owner: string;
  title: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  repro: string;
  source: string;
  /** Presets in which this failure was seen (sorted). The dev presets page reads it. Omitted when none. */
  presetIds?: string[];
}

/** Pull a site out of the info (explicit, or from `file.cpp:123` in its text). */
export function siteOfInfo(info: FailureInfo): Site | null {
  return info.site ?? siteFromText(`${info.message ?? ""} ${info.text ?? ""}`);
}

/** Owner of a failure: the known class owner, else the owner of its core site, else UNOWNED. */
export function ownerOfFailure(info: FailureInfo, rows: OwnerRow[]): { owner: string; known: Classification | null } {
  const known = classifyKnown(info);
  if (known) return { owner: known.owner, known };
  const site = siteOfInfo(info);
  return { owner: site ? ownerOf(site, rows) : UNOWNED, known: null };
}

/** Write or update `<dir>/<sig>.json`. A second call for the same sig keeps `firstSeen`, raises `count` and sets `lastSeen`. */
export function recordIssue(dir: string, input: { sig: string; owner: string; title: string; repro: string; source: string; presetId?: string; now?: Date }): IssueRecord {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${input.sig}.json`);
  const now = (input.now ?? new Date()).toISOString();
  let previous: Partial<IssueRecord> | null = null;
  if (existsSync(file)) {
    try {
      previous = JSON.parse(readFileSync(file, "utf8")) as Partial<IssueRecord>;
    } catch {
      previous = null;
    }
  }
  const before = Array.isArray(previous?.presetIds) ? previous.presetIds.filter((v): v is string => typeof v === "string") : [];
  const presetIds = [...new Set([...before, ...(input.presetId ? [input.presetId] : [])])].sort();
  const record: IssueRecord = {
    sig: input.sig,
    owner: input.owner,
    title: input.title,
    firstSeen: previous?.firstSeen ?? now,
    lastSeen: now,
    count: (previous?.count ?? 0) + 1,
    repro: input.repro,
    source: input.source,
    ...(presetIds.length > 0 ? { presetIds } : {}),
  };
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return record;
}

export function readIssues(dir: string): IssueRecord[] {
  if (!existsSync(dir)) return [];
  const out: IssueRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as IssueRecord);
    } catch {
      // skip a broken file
    }
  }
  return out.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
