/** Refresh import compatibility from Dueling Book's public static card export, without authentication or retries. */
import Database from "better-sqlite3";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isPlayable, normalizeArtworkName, type EngineRow } from "../src/engine-card-identity.js";

const SOURCE = "https://static.duelingbook.com/cards.json";
const TABLE_FILE = "packages/duel-server/duelingbook-alt-passcodes.json";
const NAMES_FILE = "packages/duel-server/duelingbook-alt-passcode-names.json";
const root = fileURLToPath(new URL("../../..", import.meta.url));
type Reason = "engineKnown" | "missingTarget" | "unplayableTarget" | "nameMismatch" | "invalidPasscode" | "ambiguous";
type Report = {
  source: string;
  cards: number;
  alternateRows: number;
  mapped: number;
  skipped: Record<Reason, number>;
  examples: Record<Reason, string[]>;
};
type Options = {
  dataDirectory?: string;
  tablePath?: string;
  namesPath?: string;
  artifactDirectory?: string;
  request?: typeof fetch;
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const passcode = (value: unknown): number | null => {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const code = Number(value);
  return Number.isSafeInteger(code) && code > 0 && code <= 0xffffffff ? code : null;
};
async function previous(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}

/** An unavailable or malformed feed leaves committed evidence intact without failing the card-data update. */
export async function refreshDuelingBookPasscodes(options: Options = {}): Promise<Report | null> {
  const tablePath = options.tablePath ?? join(root, TABLE_FILE);
  const namesPath = options.namesPath ?? join(root, NAMES_FILE);
  const dataDirectory = resolve(options.dataDirectory ?? process.env.DUEL_DATA_DIR ?? join(root, "data/duel-engine"));
  const temporary = [tablePath, namesPath].map(path => `${path}.${process.pid}.tmp`);
  try {
    const response = await (options.request ?? fetch)(SOURCE, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${SOURCE}`);
    const data: unknown = await response.json();
    const cards = Array.isArray(data) ? data : object(data) && Array.isArray(data.cards) ? data.cards : null;
    if (!cards?.length) throw new Error("Expected a nonempty cards array");
    const report: Report = { source: SOURCE, cards: cards.length, alternateRows: 0, mapped: 0,
      skipped: { engineKnown: 0, missingTarget: 0, unplayableTarget: 0, nameMismatch: 0, invalidPasscode: 0, ambiguous: 0 },
      examples: { engineKnown: [], missingTarget: [], unplayableTarget: [], nameMismatch: [], invalidPasscode: [], ambiguous: [] } };
    const skip = (reason: Reason, detail: string) => {
      report.skipped[reason] += 1;
      if (report.examples[reason].length < 5) report.examples[reason].push(detail);
    };
    const cdb = new Database(join(dataDirectory, "cards.cdb"), { readonly: true, fileMustExist: true });
    const ids = new Set<number>();
    const engine = new Map<number, EngineRow>();
    try {
      for (const row of cdb.prepare<[], { id: number }>("SELECT id FROM datas").all()) ids.add(row.id);
      for (const row of cdb.prepare<[], EngineRow>("SELECT datas.id, ot, alias, type, texts.name FROM datas JOIN texts USING(id)").all()) engine.set(row.id, row);
    } finally { cdb.close(); }
    const candidates: { alt: number; code: number; name: string }[] = [];
    const targets = new Map<number, Set<number>>();
    for (const card of cards) {
      if (!object(card)) throw new Error("Invalid card record");
      const rawAlt = card.alt_passcode ?? card.s2;
      if (rawAlt === undefined || rawAlt === null || rawAlt === "" || rawAlt === 0 || rawAlt === "0") continue;
      report.alternateRows += 1;
      const alt = passcode(rawAlt), code = passcode(card.serial_number ?? card.s);
      const name = card.name ?? card.n;
      if (typeof name !== "string" || !normalizeArtworkName(name)) throw new Error("Alternate card lacks a name");
      const detail = `${String(rawAlt)} -> ${String(card.serial_number ?? card.s)} (${name})`;
      if (alt === null || code === null) { skip("invalidPasscode", detail); continue; }
      const group = targets.get(alt) ?? new Set<number>();
      group.add(code); targets.set(alt, group);
      candidates.push({ alt, code, name });
    }
    if (report.alternateRows === 0) throw new Error("No alternate passcodes found; refusing to erase the old table");
    const table = new Map<number, number>(), names = new Map<number, string>();
    for (const { alt, code, name } of candidates) {
      const detail = `${alt} -> ${code} (${name})`;
      if (ids.has(alt)) { skip("engineKnown", detail); continue; }
      if (targets.get(alt)!.size > 1) { skip("ambiguous", detail); continue; }
      const row = engine.get(code);
      if (!row) { skip("missingTarget", detail); continue; }
      if (row.alias !== 0 || !isPlayable(row)) { skip("unplayableTarget", detail); continue; }
      if (normalizeArtworkName(name) !== normalizeArtworkName(row.name)) { skip("nameMismatch", `${detail}; engine: ${row.name}`); continue; }
      table.set(alt, code); names.set(code, row.name);
    }
    if (table.size === 0) throw new Error("No verified alternate passcodes; refusing to erase the old table");
    report.mapped = table.size;
    const json = (entries: Map<number, unknown>) => JSON.stringify(Object.fromEntries([...entries].sort(([a], [b]) => a - b)), null, 2) + "\n";
    const tableBytes = json(table), nameBytes = json(names);
    const changedFiles = [
      ...((await previous(tablePath)) === tableBytes ? [] : [TABLE_FILE]),
      ...((await previous(namesPath)) === nameBytes ? [] : [NAMES_FILE]),
    ];
    // Validate the entire response before replacing either file. Readers reject any stale name evidence.
    await writeFile(temporary[0], tableBytes); await writeFile(temporary[1], nameBytes);
    await rename(temporary[0], tablePath); await rename(temporary[1], namesPath);
    if (options.artifactDirectory) {
      const metadataPath = join(options.artifactDirectory, "update.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      const manifest = JSON.parse(await readFile(join(dataDirectory, "manifest.json"), "utf8"));
      metadata.next = Object.fromEntries(["scripts", "database", "strings"].map(key => [key, manifest.sources[key]]));
      metadata.files = [...new Set([...metadata.files, ...changedFiles])];
      metadata.changed = metadata.files.length > 0;
      if (changedFiles.length) delete metadata.matchingPrHead;
      metadata.duelingBook = report;
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
      await writeFile(join(options.artifactDirectory, "duelingbook.json"), JSON.stringify(report, null, 2) + "\n");
    }
    console.log(`[duelingbook] ${JSON.stringify(report)}`);
    return report;
  } catch (error) {
    console.warn(`[duelingbook] Refresh skipped; keeping committed table: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    await Promise.all(temporary.map(path => rm(path, { force: true })));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { "data-dir": { type: "string" }, "update-artifact": { type: "string" } } });
  await refreshDuelingBookPasscodes({ dataDirectory: values["data-dir"], artifactDirectory: values["update-artifact"] });
}
