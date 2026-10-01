/**
 * Owner lookup for core sites: file + function (or file + line) -> task tag, from `scripts/owners.tsv`.
 * Pure: `parseOwners` takes the text, `loadOwners` reads the file. An unknown site is "UNOWNED".
 */
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UNOWNED = "UNOWNED";

export interface OwnerRow {
  file: string;
  /** "*" = any function. */
  fn: string;
  /** Inclusive range, or null = any line. */
  lines: [number, number] | null;
  tag: string;
  note: string;
}

/** A place in the core. A census row is `{file, line, fn}`. `fn` or `line` may be missing. */
export interface Site {
  file: string;
  line?: number | undefined;
  fn?: string | undefined;
}

export function parseOwners(text: string): OwnerRow[] {
  const rows: OwnerRow[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim() || raw.startsWith("#")) return;
    const cols = raw.split("\t");
    if (cols.length < 4) throw new Error(`owners.tsv line ${index + 1}: need file, function, lines, tag`);
    const [file, fn, lines, tag, note] = cols as [string, string, string, string, string | undefined];
    let range: [number, number] | null = null;
    if (lines !== "-") {
      const m = /^(\d+)-(\d+)$/.exec(lines);
      if (!m) throw new Error(`owners.tsv line ${index + 1}: lines must be "-" or "a-b", got "${lines}"`);
      range = [Number(m[1]), Number(m[2])];
      if (range[0] > range[1]) throw new Error(`owners.tsv line ${index + 1}: empty range ${lines}`);
    }
    rows.push({ file: file.trim(), fn: fn.trim(), lines: range, tag: tag.trim(), note: (note ?? "").trim() });
  });
  return rows;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const OWNERS_FILE = resolve(HERE, "../owners.tsv");

export function loadOwners(file: string = OWNERS_FILE): OwnerRow[] {
  return parseOwners(readFileSync(file, "utf8"));
}

function matches(row: OwnerRow, site: Site): boolean {
  if (row.file !== basename(site.file)) return false;
  if (site.fn === undefined) {
    // Without a function only a line range can place the site.
    return row.lines !== null && site.line !== undefined && site.line >= row.lines[0] && site.line <= row.lines[1];
  }
  if (row.fn !== "*" && row.fn !== site.fn) return false;
  if (row.lines === null) return true;
  return site.line !== undefined && site.line >= row.lines[0] && site.line <= row.lines[1];
}

/** Every owner tag that matches, first (most specific) first, without repeats. */
export function ownersOf(site: Site, rows: OwnerRow[]): string[] {
  const tags: string[] = [];
  for (const row of rows) if (matches(row, site) && !tags.includes(row.tag)) tags.push(row.tag);
  return tags;
}

/** The first matching owner tag, or "UNOWNED". */
export function ownerOf(site: Site, rows: OwnerRow[]): string {
  return ownersOf(site, rows)[0] ?? UNOWNED;
}

/** Find `file.cpp:123` in a text (a trap line, a sanitizer line, a stack). */
export function siteFromText(text: string): Site | null {
  const m = /([A-Za-z0-9_]+\.(?:cpp|h|hpp|cc)):(\d+)/.exec(text);
  return m ? { file: m[1]!, line: Number(m[2]) } : null;
}

