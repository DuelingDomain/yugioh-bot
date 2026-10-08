import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { canonicalCardCode } from "@yugidraft/shared/duels";
import type { ScriptOverlay } from "./multi-scripts.js";

export interface CardScriptSource {
  readonly dataDirectory?: string;
  deckCard(code: number): { alias?: number; name: string; type?: number } | undefined;
  readScript(name: string, overlay?: ScriptOverlay): string | null;
  scriptNames?(): Iterable<string>;
}

export function indexScripts(root: string): Map<string, string> {
  const indexed = new Map<string, string>();
  if (!existsSync(root)) return indexed;
  const priority = (path: string) => {
    const name = relative(root, path).replaceAll("\\", "/");
    return name.startsWith("official/") ? 3 : name.startsWith("pre-release/") ? 2 : !name.includes("/") ? 1 : 0;
  };
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.name.endsWith(".lua")) continue;
      const previous = indexed.get(entry.name);
      if (!previous || priority(full) > priority(previous)) indexed.set(entry.name, full);
      const path = relative(root, full).replaceAll("\\", "/");
      if (path !== entry.name) indexed.set(path, full);
    }
  };
  visit(root);
  return indexed;
}


/** Export-only reader: fetch name/alias metadata on demand, never load the catalog. */
export function readOnlyCardScriptSource(directory: string): CardScriptSource & { close(): void } {
  const root = resolve(directory);
  const db = new Database(join(root, "cards.cdb"), { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON"); db.pragma("cache_size = -1024");
  const find = db.prepare("SELECT d.alias, d.type, t.name FROM datas d LEFT JOIN texts t ON t.id = d.id WHERE d.id = ?");
  const metadata = new Map<number, { alias: number; type: number; name: string }>();
  const card = (code: number) => {
    const cached = metadata.get(code);
    if (cached) return cached;
    const row = find.get(code) as { alias: number; type: number; name: string | null } | undefined;
    if (!row) return undefined;
    const result = { ...row, name: row.name ?? `Card ${code}` };
    metadata.set(code, result); return result;
  };
  let scripts: Map<string, string>;
  try { scripts = indexScripts(join(root, "card-scripts")); }
  catch (error) { db.close(); throw error; }
  return {
    dataDirectory: root, deckCard: card, scriptNames: () => scripts.keys(), close: () => db.close(),
    readScript(name, overlay) {
      const normalized = name.replaceAll("\\", "/"), basename = normalized.split("/").at(-1)!;
      let resolvedName = name, file = scripts.get(normalized) ?? scripts.get(basename);
      if (!file) {
        const match = /^c(\d+)\.lua$/.exec(basename);
        if (match) {
          const code = Number(match[1]), seen = new Set<number>();
          let current = code;
          while (!seen.has(current)) {
            seen.add(current);
            const row = card(current);
            if (!row?.alias || !card(row.alias)) break;
            current = row.alias;
          }
          const canonicalName = `c${canonicalCardCode(code, metadata)}.lua`;
          file = scripts.get(canonicalName);
          if (file) resolvedName = canonicalName;
        }
      }
      const original = file ? readFileSync(file, "utf8") : null;
      return overlay ? overlay.apply(resolvedName, original) : original;
    },
  };
}
