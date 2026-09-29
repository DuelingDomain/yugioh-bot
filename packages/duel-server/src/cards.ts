import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import {
  OcgType,
  ocgAttributeParse,
  ocgAttributeString,
  ocgRaceParse,
  ocgRaceString,
  type OcgAttribute,
  type OcgCardData,
  type OcgRace,
} from "ocgcore-wasm";

export interface CardTextEntry {
  name: string;
  description: string;
  strings: string[];
}

export interface CardDatabase {
  search(query: string, matches?: (card: OcgCardData) => boolean): DuelCardInfo[];
  get(code: number): DuelCardInfo | undefined;
  cardData(code: number): OcgCardData | null;
  resolveLabel(desc: bigint | number): string;
  system(id: number): string | undefined;
  victory(id: number): string | undefined;
  counter(id: number): string | undefined;
  readScript(name: string): string | null;
  close(): void;
}

const cache = new Map<string, CardDatabase>();

function asNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function asBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function unpackSetcodes(setcode: bigint): number[] {
  const codes: number[] = [];
  for (let shift = 0n; shift < 64n; shift += 16n) {
    const code = Number((setcode >> shift) & 0xffffn);
    if (code) codes.push(code);
  }
  return codes;
}

function formatRace(race: bigint): string {
  try {
    const parts = ocgRaceParse(race as OcgRace).flatMap((value) => {
      const name = ocgRaceString.get(value);
      return name ? [name] : [];
    });
    return parts.join("/") || "unknown";
  } catch {
    return "unknown";
  }
}

function formatAttribute(attribute: number): string {
  try {
    const parts = ocgAttributeParse(attribute as OcgAttribute).flatMap((value) => {
      const name = ocgAttributeString.get(value);
      return name ? [name] : [];
    });
    return parts.join("/") || "unknown";
  } catch {
    return "unknown";
  }
}

export function isOptionalCardScript(name: string, cardData: (code: number) => OcgCardData | null): boolean {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? name;
  const match = /^c(\d+)\.lua$/i.exec(base);
  if (!match) return false;
  const code = Number(match[1]);
  if (code === 0) return true;
  const data = cardData(code);
  if (!data) return false;
  const type = Number(data.type);
  if (type & (OcgType.SPELL | OcgType.TRAP | OcgType.EFFECT | OcgType.PENDULUM)) return false;
  return (type & OcgType.NORMAL) !== 0;
}

function indexScripts(root: string): Map<string, string> {
  const indexed = new Map<string, string>();
  if (!existsSync(root)) return indexed;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.name.endsWith(".lua")) continue;
      indexed.set(entry.name, full);
      indexed.set(relative(root, full).replaceAll("\\", "/"), full);
    }
  };
  visit(root);
  return indexed;
}

function parseConf(contents: string, prefix: string): Map<number, string> {
  const values = new Map<number, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^!${prefix}\\s+(\\S+)\\s+(.*)$`));
    if (!match) continue;
    values.set(Number.parseInt(match[1], match[1].startsWith("0x") || match[1].startsWith("0X") ? 16 : 10), match[2]);
  }
  return values;
}

function loadFromDisk(root: string): CardDatabase {
  const cdbPath = join(root, "cards.cdb");
  const stringsPath = join(root, "strings.conf");
  const scriptRoot = join(root, "card-scripts");
  if (!existsSync(cdbPath)) throw new Error(`Card database missing: ${cdbPath}`);
  if (!existsSync(stringsPath)) throw new Error(`strings.conf missing: ${stringsPath}`);
  if (!existsSync(scriptRoot)) throw new Error(`Card scripts missing: ${scriptRoot}`);

  const sqlite = new Database(cdbPath, { readonly: true, fileMustExist: true });
  const datas = new Map<number, OcgCardData>();
  const texts = new Map<number, CardTextEntry>();
  const info = new Map<number, DuelCardInfo>();
  try {
    const dataRows = sqlite.prepare("SELECT * FROM datas").all() as Array<{
      id: number | bigint;
      alias: number | bigint;
      setcode: number | bigint;
      type: number | bigint;
      atk: number | bigint;
      def: number | bigint;
      level: number | bigint;
      race: number | bigint;
      attribute: number | bigint;
    }>;
    for (const row of dataRows) {
      const type = asNumber(row.type);
      const levelPacked = asNumber(row.level);
      const card: OcgCardData = {
        code: asNumber(row.id),
        alias: asNumber(row.alias),
        setcodes: unpackSetcodes(asBigInt(row.setcode)),
        type,
        attack: asNumber(row.atk),
        defense: type & OcgType.LINK ? 0 : asNumber(row.def),
        link_marker: type & OcgType.LINK ? asNumber(row.def) : 0,
        level: levelPacked & 0xff,
        lscale: (levelPacked >> 24) & 0xff,
        rscale: (levelPacked >> 16) & 0xff,
        race: asBigInt(row.race),
        attribute: asNumber(row.attribute),
      };
      datas.set(card.code, card);
    }
    const textRows = sqlite.prepare("SELECT * FROM texts").all() as Array<Record<string, unknown>>;
    for (const row of textRows) {
      const code = asNumber(row.id as number | bigint);
      const strings = Array.from({ length: 16 }, (_, index) => String(row[`str${index + 1}`] ?? ""));
      texts.set(code, {
        name: String(row.name ?? `Card ${code}`),
        description: String(row.desc ?? ""),
        strings,
      });
    }
  } finally {
    sqlite.close();
  }

  for (const [code, card] of datas) {
    const text = texts.get(code);
    info.set(code, {
      code,
      name: text?.name ?? `Card ${code}`,
      description: text?.description ?? "",
      type: card.type as number,
      attack: card.attack,
      defense: card.defense,
      level: card.level,
      attribute: card.attribute as number,
      race: formatRace(card.race as bigint),
    });
  }

  const stringsFile = readFileSync(stringsPath, "utf8");
  const system = parseConf(stringsFile, "system");
  const victory = parseConf(stringsFile, "victory");
  const counters = parseConf(stringsFile, "counter");
  const scripts = indexScripts(scriptRoot);

  const database: CardDatabase = {
    search(query: string, matches?: (card: OcgCardData) => boolean) {
      const needle = query.trim().toLowerCase();
      if (!needle && !matches) return [];
      const found: DuelCardInfo[] = [];
      for (const card of info.values()) {
        if (needle && !card.name.toLowerCase().includes(needle) && !String(card.code).includes(needle)) continue;
        if (matches) {
          const data = datas.get(card.code);
          if (!data || !matches(data)) continue;
        }
        found.push(card);
        if (found.length >= 50) break;
      }
      return found;
    },
    get(code) {
      return info.get(code);
    },
    cardData(code) {
      return datas.get(code) ?? null;
    },
    resolveLabel(desc) {
      const value = typeof desc === "bigint" ? desc : BigInt(desc);
      if (value > 0n && value <= 0xffffffffn) {
        const named = info.get(Number(value));
        if (named?.name) return named.name;
      }
      const card = Number(value >> 20n);
      const index = Number(value & 0xfffffn);
      if (card !== 0) {
        const entry = texts.get(card);
        const named = entry?.strings[index];
        if (named) return named;
        if (entry?.name) return entry.name;
      }
      return system.get(Number(value)) ?? (index !== 0 ? system.get(index) : undefined) ?? "";
    },
    system(id) {
      return system.get(id);
    },
    victory(id) {
      return victory.get(id);
    },
    counter(id) {
      return counters.get(id);
    },
    readScript(name) {
      const normalized = name.replaceAll("\\", "/");
      const file = scripts.get(normalized) ?? scripts.get(normalized.split("/").pop() ?? "");
      if (!file) return null;
      return readFileSync(file, "utf8");
    },
    close() {
      cache.delete(root);
    },
  };
  return database;
}

/** Loads CDB, strings, and script index. Cached per absolute data directory. */
export function loadCardDatabase(dataDirectory: string): CardDatabase {
  const root = resolve(dataDirectory);
  const existing = cache.get(root);
  if (existing) return existing;
  const loaded = loadFromDisk(root);
  cache.set(root, loaded);
  return loaded;
}

export function cardInfoLabel(cards: CardDatabase, code: number): string {
  return cards.get(code)?.name ?? `Card ${code}`;
}

export function attributeLabel(attribute: number): string {
  return formatAttribute(attribute);
}

export function raceLabel(race: bigint | number): string {
  return formatRace(typeof race === "bigint" ? race : BigInt(race));
}
