import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { canonicalCardCode, type DeckCardInfo, type DuelCardInfo } from "@yugidraft/shared/duels";
import type { ScriptOverlay } from "./multi-scripts.js";
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
  /** The deck editor's view of a card: duel info plus setcodes, scales, Link Arrows and card pool. */
  deckCard(code: number): DeckCardInfo | undefined;
  /** Every card in catalog order, alternate artworks and tokens included. */
  all(): Iterable<DeckCardInfo>;
  /** Archetype names from strings.conf, by setcode. */
  setnames(): ReadonlyMap<number, string>;
  cardData(code: number): OcgCardData | null;
  resolveLabel(desc: bigint | number): string;
  system(id: number): string | undefined;
  victory(id: number): string | undefined;
  counter(id: number): string | undefined;
  /** Script text by name. `overlay` (duels with more than two seats only) maps the original text; omitted, the text is the original. */
  readScript(name: string, overlay?: ScriptOverlay): string | null;
  close(): void;
}

export interface LoadedCardDatabase extends CardDatabase {
  /** Alternate scripts that would load a main script under a different GetID context. `requested` is the script the core asks for. */
  artworkScriptFallbacks(): Array<{ passcode: number; main: number; requested: number }>;
}

const cache = new Map<string, LoadedCardDatabase>();

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

function parseConf(contents: string, prefix: string): Map<number, string> {
  const values = new Map<number, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^!${prefix}\\s+(\\S+)\\s+(.*)$`));
    if (!match) continue;
    values.set(Number.parseInt(match[1], match[1].startsWith("0x") || match[1].startsWith("0X") ? 16 : 10), match[2]);
  }
  return values;
}

function loadFromDisk(root: string): LoadedCardDatabase {
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
  const deckCards = new Map<number, DeckCardInfo>();
  const pools = new Map<number, number>();
  try {
    const dataRows = sqlite.prepare("SELECT * FROM datas").all() as Array<{
      id: number | bigint;
      ot: number | bigint;
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
      pools.set(card.code, asNumber(row.ot));
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
    const base: DuelCardInfo = {
      code,
      name: text?.name ?? `Card ${code}`,
      description: text?.description ?? "",
      type: card.type as number,
      attack: card.attack,
      defense: card.defense,
      level: card.level,
      attribute: card.attribute as number,
      race: formatRace(card.race as bigint),
    };
    info.set(code, base);
    deckCards.set(code, {
      ...base,
      alias: card.alias,
      setcodes: card.setcodes,
      lscale: card.lscale,
      rscale: card.rscale,
      arrows: card.link_marker,
      ot: pools.get(code) ?? 0,
    });
  }

  // Resolve after the whole catalog is loaded: an alias target may appear later.
  for (const [code, card] of deckCards) {
    const canonicalPasscode = canonicalCardCode(code, deckCards);
    card.canonicalPasscode = canonicalPasscode;
    info.get(code)!.canonicalPasscode = canonicalPasscode;
  }

  const stringsFile = readFileSync(stringsPath, "utf8");
  const system = parseConf(stringsFile, "system");
  const victory = parseConf(stringsFile, "victory");
  const counters = parseConf(stringsFile, "counter");
  const setnames = parseConf(stringsFile, "setname");
  const scripts = indexScripts(scriptRoot);

  const warnedFallbacks = new Set<string>();
  const database: LoadedCardDatabase = {
    search(query: string, matches?: (card: OcgCardData) => boolean) {
      const needle = query.trim().toLowerCase();
      if (!needle && !matches) return [];
      const found: DuelCardInfo[] = [];
      // An exact passcode comes first, so a lookup by code never falls past the result cap.
      const exact = /^\d+$/.test(needle) ? info.get(Number(needle)) : undefined;
      const exactData = exact ? datas.get(exact.code) : undefined;
      if (exact && (!matches || (exactData && matches(exactData)))) found.push(exact);
      for (const card of info.values()) {
        if (card === exact) continue;
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
    deckCard(code) {
      return deckCards.get(code);
    },
    all() {
      return deckCards.values();
    },
    setnames() {
      return setnames;
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
    readScript(name, overlay) {
      const normalized = name.replaceAll("\\", "/");
      let resolvedName = name;
      let scriptName = normalized.split("/").pop() ?? "";
      let file = scripts.get(normalized) ?? scripts.get(scriptName);
      if (!file) {
        const match = /^c(\d+)\.lua$/.exec(scriptName);
        if (match) {
          const main = canonicalCardCode(Number(match[1]), deckCards);
          scriptName = `c${main}.lua`;
          file = scripts.get(scriptName);
          if (file) {
            resolvedName = scriptName;
            if (!warnedFallbacks.has(normalized)) {
              warnedFallbacks.add(normalized);
              console.warn(`[cards] Artwork script fallback ${normalized} → ${scriptName}; core self_code and GetID() remain ${match[1]}, not ${main}. Validate this engine bundle before deployment.`);
            }
          }
        }
      }
      const original = file ? readFileSync(file, "utf8") : null;
      return overlay ? overlay.apply(resolvedName, original) : original;
    },
    artworkScriptFallbacks() {
      // Mirror the core (interpreter.cpp): a card whose alias is within 10 passcodes loads the alias's script, so
      // c{code}.lua is never requested for it. Only a script the core really requests can need the fallback.
      return [...deckCards.entries()].flatMap(([passcode, card]) => {
        const alias = card.alias ?? 0;
        const requested = alias && alias < passcode + 10 && passcode < alias + 10 ? alias : passcode;
        if (scripts.has(`c${requested}.lua`)) return [];
        const main = canonicalCardCode(requested, deckCards);
        return main !== requested && scripts.has(`c${main}.lua`) ? [{ passcode, main, requested }] : [];
      }).sort((a, b) => a.passcode - b.passcode);
    },
    close() {
      cache.delete(root);
    },
  };
  return database;
}

/** Loads CDB, strings, and script index. Cached per absolute data directory. */
export function loadCardDatabase(dataDirectory: string): LoadedCardDatabase {
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
