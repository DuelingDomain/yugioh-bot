import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as z from "zod";
import type Database from "better-sqlite3";
const count = z.int().min(1);
const Usage = z.object({ passcode: z.int().min(1).max(0xffffffff), name: z.string().max(160), decks: count, copies: count,
  archetypes: z.record(z.string(), count), playShare: z.number().min(0.1).max(1), averageCopies: z.number().min(1).max(3) }).strict();
const Sample = z.object({ deckCount: z.int().min(20), archetypeCount: z.int().min(3), cards: z.array(Usage).max(80),
  sources: z.array(z.object({ url: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(5) }).strict();
const Artifact = z.object({ schemaVersion: z.literal(1), generatedAt: z.iso.datetime(),
  policy: z.object({ minimumDecks: z.literal(20), minimumShare: z.literal(0.1), minimumArchetypes: z.literal(3), maximumArchetypeShare: z.literal(0.6) }).strict(),
  formats: z.object({ tcg: Sample.optional(), domain: Sample.optional(), genesys: Sample.optional(), "genesys-domain": Sample.optional() }).strict(), version: z.string() }).strict();
export type StapleUsage = z.infer<typeof Usage>;
export interface FormatStaples { version: string; label: string; cards: ReadonlyMap<number, StapleUsage> }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytes = readFileSync(new URL("../../../data/staples/usage.json", import.meta.url));
if (bytes.length > 500_000) throw Error("Staple artifact too large");
const artifact = Artifact.parse(JSON.parse(bytes.toString()));
const { version, ...identity } = artifact;
if (hash(identity) !== version) throw Error("Staple artifact integrity failed");
for (const sample of Object.values(artifact.formats)) {
  const ids = new Set<number>();
  for (const card of sample.cards) {
    if (ids.has(card.passcode) || card.playShare !== card.decks/sample.deckCount || card.averageCopies !== card.copies/card.decks
      || Object.keys(card.archetypes).length < 3 || Object.values(card.archetypes).reduce((a,b)=>a+b,0) !== card.decks
      || Math.max(...Object.values(card.archetypes))/card.decks > 0.6) throw Error("Invalid staple counts");
    ids.add(card.passcode);
  }
}
export const FORMAT_STAPLES_VERSION = version;
export function stapleFormat(format = "normal", banlist?: string): string {
  return format === "normal" ? banlist?.startsWith("ocg") ? "ocg" : "tcg" : format;
}
export const stapleReason = (usage: StapleUsage, label: string) => `Played in ${Math.round(usage.playShare * 100)}% of ${label} decks`;
const localCaches = new WeakMap<Database.Database, { key: string; formats: Map<string, StapleUsage[]>; counts: Map<string, number> }>();
/** Private aggregate: reads no owner IDs and exports no individual decks. Small cohorts are ignored. */
function savedUsage(db: Database.Database) {
  const key = hash([db.prepare("SELECT revision FROM card_staple_source_revision WHERE id=1").get(),
    db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get(), db.prepare("SELECT revision FROM card_effect_revision WHERE id=1").get()]);
  const old = localCaches.get(db);
  if (old?.key === key) return old;
  const canonicalRow = db.prepare<[number], { card_id: number }>("SELECT card_id FROM card_artworks WHERE artwork_id=?");
  const canonical = (id: number) => canonicalRow.get(id)?.card_id ?? id;
  const buckets = new Map<string, Map<string, { codes: number[]; archetype: string }>>();
  const metadata = db.prepare<[number], { archetype: string | null; name: string; effect_text: string; tags_json: string | null }>(`SELECT c.archetype,c.name,c.effect_text,t.tags_json FROM card_catalog c LEFT JOIN card_tags t ON t.passcode=c.ygoprodeck_id WHERE c.ygoprodeck_id=?`);
  const info = new Map<number, ReturnType<typeof metadata.get>>();
  const card = (id: number) => { if (!info.has(id)) info.set(id, metadata.get(id)); return info.get(id); };
  const genericCache = new Map<number, boolean>();
  const generic = (id: number): boolean => {
    if (genericCache.has(id)) return genericCache.get(id)!;
    const meta = card(id); let result = false;
    try {
      const tags = meta?.tags_json && JSON.parse(meta.tags_json);
      result = !!tags && !tags.supports?.archetypes?.length && !tags.supports?.names?.some((name: string) => name !== meta!.name) && !/"[^"\n]+"\s+(?:monster|card|spell|trap)|(?:control|tribute|discard|send|summon)[^.\n]{0,50}"[^"\n]+"/i.test(meta!.effect_text.replaceAll(`"${meta!.name}"`, "SELF"));
    } catch { /* Invalid cached tags do not establish a generic card. */ }
    genericCache.set(id,result); return result;
  };
  for (const row of db.prepare("SELECT mode,genesys_json,deck_json FROM saved_decks LIMIT 10000").iterate() as Iterable<{ mode: string; genesys_json: string | null; deck_json: string }>) {
    try {
      const deck = JSON.parse(row.deck_json);
      if (![deck.main,deck.extra,deck.side].every(Array.isArray) || deck.main.length < (row.mode === "domain" ? 60 : 40) || deck.main.length > 60 || deck.extra.length > 15 || deck.side.length > 15) continue;
      const codes: number[] = [...deck.main,...deck.extra,...deck.side].map(canonical);
      if (codes.some(id => !Number.isInteger(id) || id < 1 || !card(id))) continue;
      const groups = new Map<string, number>();
      for (const code of deck.main) { const id = canonical(code), a = card(id)?.archetype; if (a && !generic(id)) groups.set(a,(groups.get(a)??0)+1); }
      const archetype = [...groups].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      if (!archetype) continue;
      const format = row.genesys_json ? row.mode === "domain" ? "genesys-domain" : "genesys" : stapleFormat(row.mode);
      if (!buckets.has(format)) buckets.set(format,new Map());
      buckets.get(format)!.set(hash([...codes].sort((a,b)=>a-b)),{ codes, archetype });
    } catch { /* Ignore invalid saved lists. */ }
  }
  const result = { key, formats: new Map<string, StapleUsage[]>(), counts: new Map<string, number>() };
  for (const [format,decks] of buckets) {
    if (decks.size < 20) continue;
    const rows = new Map<number, StapleUsage>();
    for (const deck of decks.values()) {
      const copies = new Map<number,number>();
      for (const id of deck.codes) copies.set(id,(copies.get(id)??0)+1);
      for (const [id,n] of copies) {
        const meta = card(id); if (!meta || n > 3 || !generic(id)) continue;
        const row = rows.get(id) ?? { passcode:id,name:meta.name,decks:0,copies:0,archetypes:{},playShare:0,averageCopies:0 };
        row.decks++; row.copies+=n; row.archetypes[deck.archetype]=(row.archetypes[deck.archetype]??0)+1; rows.set(id,row);
      }
    }
    const cards = [...rows.values()].filter(row=> row.decks/decks.size>=0.1 && Object.keys(row.archetypes).length>=3 && Math.max(...Object.values(row.archetypes))/row.decks<=0.6)
      .map(row=>({...row,playShare:row.decks/decks.size,averageCopies:row.copies/row.decks}))
      .sort((a,b)=>b.playShare-a.playShare || b.averageCopies-a.averageCopies || a.passcode-b.passcode).slice(0,80);
    if (cards.length) { result.formats.set(format,cards); result.counts.set(format,decks.size); }
  }
  localCaches.set(db,result); return result;
}
export function formatStaples(format = "normal", banlist?: string, db?: Database.Database): FormatStaples {
  const key = stapleFormat(format,banlist), sample = artifact.formats[key as keyof typeof artifact.formats];
  const local = db ? savedUsage(db) : undefined, localCards = local?.formats.get(key);
  // A private cohort is an independent source. Public samples remain the stable default.
  const cards = localCards ?? sample?.cards ?? [];
  return { version: `${version}:${localCards ? local!.key : "public"}`, label: key === "tcg" ? "TCG" : key === "domain" ? "Domain" : key === "genesys" ? "Genesys" : key === "genesys-domain" ? "Genesys Domain" : "OCG", cards: new Map(cards.map(row=>[row.passcode,row])) };
}
