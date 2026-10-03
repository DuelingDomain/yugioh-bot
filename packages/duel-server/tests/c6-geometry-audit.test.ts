import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { engineDataDirectory } from "./engine-data-dir.js";

type Row = { script: string; line: number; expression: string; result: string; requiresAbsentCode?: number };
type Audit = { pattern: string; stock: Row[]; overlay: Row[] };
const table = JSON.parse(readFileSync(new URL("./fixtures/c6-geometry-audit.json", import.meta.url), "utf8")) as Audit;
const pattern = /\+\s*0x10\b|\b16\s*\+|GetPreviousSequence|\+\s*16\b|(?:<<|>>)\s*16\b|\b4\s*-|\b11\s*-|IsColumn/;
const stock = join(engineDataDirectory, "card-scripts");
const overlay = resolve(process.env.DUEL_MULTI_SCRIPTS_DIR ?? new URL("../domain-core/multi-scripts/", import.meta.url).pathname);
function hits(root: string, relative = ""): Omit<Row, "result">[] {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const script = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return hits(root, script);
    if (!entry.name.endsWith(".lua")) return [];
    return readFileSync(join(root, script), "utf8").split(/\r?\n/).flatMap((expression, index) =>
      pattern.test(expression) ? [{ script, line: index + 1, expression: expression.trim() }] : []);
  });
}
function check(root: string, rows: Row[]): void {
  function keys(hits: Omit<Row, "result">[]) {
    const occurrences = new Map<string, number>();
    return hits.map(({ script, expression }) => {
      const key = JSON.stringify([script, expression]);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      return { script, expression, occurrence };
    }).sort((a, b) => a.script.localeCompare(b.script) || a.expression.localeCompare(b.expression) || a.occurrence - b.occurrence);
  }
  const actual = keys(hits(root));
  const reviewed = rows.map(({ result, requiresAbsentCode, ...hit }) => {
    if (/no (?:database )?row/.test(result)) expect(requiresAbsentCode, `${hit.script}: missing database watch`).toBeGreaterThan(0);
    expect(result, `${hit.script}:${hit.line}: missing reason`).toMatch(/^(C6 fixed|Fixed|C3\/C4|Excluded|Native)/);
    return hit;
  });
  expect(actual, "Each geometry expression needs one audit row and a reason").toEqual(keys(reviewed));
}
it("covers every stock geometry regex hit in all Lua folders, with a reason", () => {
  expect(table.pattern).toBe(pattern.source);
  check(stock, table.stock);
});
it("covers every overlay geometry regex hit, with a reason", () => check(overlay, table.overlay));
it("refuses a database row for a script excluded only from the current card data", () => {
  const db = new Database(join(engineDataDirectory, "cards.cdb"), { readonly: true });
  try {
    for (const row of table.stock.filter(row => row.requiresAbsentCode !== undefined)) {
      const code = row.requiresAbsentCode!;
      expect(Number(/(?:^|\/)c(\d+)\.lua$/.exec(row.script)?.[1]), row.script).toBe(code);
      expect(code, row.script).toBeGreaterThan(0);
      expect(db.prepare("SELECT id FROM datas WHERE id=?").get(code), `${row.script}: review the mirror rule before this script becomes loadable`).toBeUndefined();
    }
  } finally { db.close(); }
});
