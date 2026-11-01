import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import { log } from "../../observability/index.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as z from "zod";
import { compactEffectName } from "./name-match.js";
import type Database from "better-sqlite3";
const count = z.int().min(1);
const Usage = z.object({ passcode: z.int().min(1).max(0xffffffff), name: z.string().max(160), decks: count, copies: count,
  archetypes: z.record(z.string(), count), playShare: z.number().min(0.1).max(1), averageCopies: z.number().min(1).max(3) }).strict();
const Sample = z.object({ deckCount: z.int().min(20), archetypeCount: z.int().min(3), cards: z.array(Usage).max(80),
  genericUsage: z.array(z.object({passcode:z.int().min(1).max(0xffffffff),decks:count}).strict()).max(7200),
  archetypeDeckCounts: z.record(z.string(),count),
  archetypeUsage: z.record(z.string(),z.array(z.object({passcode:z.int().min(1).max(0xffffffff),decks:count}).strict()).max(40)),
  sources: z.array(z.object({ url: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(50) }).strict();
const Artifact = z.object({ schemaVersion: z.literal(3), generatedAt: z.iso.datetime(),
  policy: z.object({ minimumDecks: z.literal(20), minimumShare: z.literal(0.1), minimumArchetypes: z.literal(3), maximumArchetypeShare: z.literal(0.6) }).strict(),
  formats: z.object({ tcg: Sample.optional(), domain: Sample.optional(), genesys: Sample.optional(), "genesys-domain": Sample.optional() }).strict(), version: z.string() }).strict();
export type StapleUsage = z.infer<typeof Usage>;
export interface FormatStaples { version: string; label: string; cards: ReadonlyMap<number, StapleUsage>; playShares: ReadonlyMap<number,number>; archetypes: ReadonlyMap<string,{decks:number;cards:ReadonlyMap<number,number>}> }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function loadArtifact(): z.infer<typeof Artifact> {
  try {
    const fd = openSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/staples/usage.json"), "r");
    let bytes: Buffer;
    try {
      if (fstatSync(fd).size > 2_000_000) throw Error("Staple artifact too large");
      const bounded = Buffer.alloc(2_000_001);
      let length = 0, read = 0;
      do { read = readSync(fd,bounded,length,bounded.length-length,null); length += read; }
      while (read > 0 && length < bounded.length);
      if (length > 2_000_000) throw Error("Staple artifact too large");
      bytes = bounded.subarray(0,length);
    } finally { closeSync(fd); }
    const rawArtifact = JSON.parse(bytes.toString());
    const { version, ...identity } = rawArtifact;
    if (hash(identity) !== version) throw Error("Staple artifact integrity failed");
    const artifact = Artifact.parse(rawArtifact);
    for (const sample of Object.values(artifact.formats)) {
      if (Object.keys(sample.archetypeDeckCounts).length !== sample.archetypeCount || Object.keys(sample.archetypeUsage).length !== sample.archetypeCount
        || Object.values(sample.archetypeDeckCounts).reduce((a,b)=>a+b,0)!==sample.deckCount) throw Error("Invalid archetype denominators");
      for (const [name,rows] of Object.entries(sample.archetypeUsage)) if (!sample.archetypeDeckCounts[name] || new Set(rows.map(row=>row.passcode)).size!==rows.length || rows.some(row=>row.decks>sample.archetypeDeckCounts[name]!)) throw Error("Invalid archetype usage");
      const genericCounts=new Map(sample.genericUsage.map(row=>[row.passcode,row.decks]));
      if(genericCounts.size!==sample.genericUsage.length || sample.genericUsage.some(row=>row.decks>sample.deckCount)) throw Error("Invalid generic usage");
      const archetypeTotals=new Map<number,number>();
      for(const rows of Object.values(sample.archetypeUsage)) for(const row of rows) archetypeTotals.set(row.passcode,(archetypeTotals.get(row.passcode)??0)+row.decks);
      if([...archetypeTotals].some(([id,n])=>n>(genericCounts.get(id)??0))) throw Error("Generic count below archetype count");
      const ids = new Set<number>();
      for (const card of sample.cards) {
        if (genericCounts.get(card.passcode)!==card.decks || ids.has(card.passcode) || card.playShare !== card.decks/sample.deckCount || card.averageCopies !== card.copies/card.decks
          || Object.keys(card.archetypes).length < 3 || Object.values(card.archetypes).reduce((a,b)=>a+b,0) !== card.decks
          || Math.max(...Object.values(card.archetypes))/card.decks > 0.6) throw Error("Invalid staple counts");
        ids.add(card.passcode);
      }
    }
    return artifact;
  } catch {
    log("warn", "Staple usage unavailable; using role fallback", {source:"format-staples"});
    return {schemaVersion:3,generatedAt:"1970-01-01T00:00:00.000Z",version:"unavailable",formats:{},
      policy:{minimumDecks:20,minimumShare:0.1,minimumArchetypes:3,maximumArchetypeShare:0.6}};
  }
}
const artifact = loadArtifact();
const version = artifact.version;
export const FORMAT_STAPLES_VERSION = version;
export function stapleFormat(format = "normal", banlist?: string): string {
  return format === "normal" ? banlist?.startsWith("ocg") ? "ocg" : "tcg" : format;
}
export const stapleReason = (usage: StapleUsage, label: string) => `Played in ${Math.round(usage.playShare * 100)}% of ${label} decks`;
const localCaches = new WeakMap<Database.Database, Map<string, { signature: string; key: string; views: Map<string,FormatStaples>; formats: Map<string, StapleUsage[]>; counts: Map<string, number>; playShares: Map<string,ReadonlyMap<number,number>> }>>();
const artworkCaches = new WeakMap<Database.Database, { revision: number; canonical: Map<number,number> }>();
const publicViews = new Map<string,FormatStaples>();
/** Private guild aggregate. Owner IDs are used only in memory to deduplicate votes. */
function savedUsage(db: Database.Database, guildId: string) {
  const revision = db.prepare<[], { saved: number; catalog: number; effects: number }>(`
    SELECT s.revision AS saved,c.revision AS catalog,e.revision AS effects
    FROM card_staple_source_revision s,card_catalog_revision c,card_effect_revision e
    WHERE s.id=1 AND c.id=1 AND e.id=1`).get()!;
  const signature = `${revision.saved}:${revision.catalog}:${revision.effects}`;
  let cache = localCaches.get(db);
  if (!cache) { cache = new Map(); localCaches.set(db, cache); }
  const old = cache.get(guildId);
  if (old?.signature === signature) return old;
  const key = hash([guildId, signature]);
  let artworks = artworkCaches.get(db);
  if (!artworks || artworks.revision !== revision.catalog) {
    const rows = db.prepare<[], { artwork_id: number; card_id: number }>("SELECT artwork_id,card_id FROM card_artworks").all();
    artworks = { revision: revision.catalog, canonical: new Map(rows.map(row=>[row.artwork_id,row.card_id])) };
    artworkCaches.set(db,artworks);
  }
  const canonical = (id: number) => artworks.canonical.get(id) ?? id;
  const buckets = new Map<string, { lists: Set<string>; owners: Map<number, { codes: number[]; archetype: string }> }>();
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
  for (const row of db.prepare("SELECT owner_user_id,mode,genesys_json,deck_json FROM saved_decks WHERE guild_id=? ORDER BY updated_at DESC,id DESC LIMIT 10000").iterate(guildId) as Iterable<{ owner_user_id: number; mode: string; genesys_json: string | null; deck_json: string }>) {
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
      if (!buckets.has(format)) buckets.set(format,{ lists: new Set(), owners: new Map() });
      const bucket = buckets.get(format)!;
      bucket.lists.add(hash([...codes].sort((a,b)=>a-b)));
      // Only the latest complete list votes for an owner in this format.
      if (!bucket.owners.has(row.owner_user_id)) bucket.owners.set(row.owner_user_id,{ codes, archetype });
    } catch { /* Ignore invalid saved lists. */ }
  }
  const result = { signature, key, views: new Map<string,FormatStaples>(), formats: new Map<string, StapleUsage[]>(), counts: new Map<string, number>(), playShares:new Map<string,ReadonlyMap<number,number>>() };
  for (const [format,bucket] of buckets) {
    const decks = bucket.owners;
    if (bucket.lists.size < 20 || decks.size < 10) continue;
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
    const cards = [...rows.values()]
      .map(row=>({...row,archetypes:Object.fromEntries(Object.entries(row.archetypes).filter(([,owners])=>owners>=3))}))
      .filter(row=> row.decks>=3 && row.decks/decks.size>=0.1 && Object.keys(row.archetypes).length>=3 && Math.max(...Object.values(row.archetypes))/row.decks<=0.6)
      .map(row=>({...row,playShare:row.decks/decks.size,averageCopies:row.copies/row.decks}))
      .sort((a,b)=>b.playShare-a.playShare || b.averageCopies-a.averageCopies || a.passcode-b.passcode).slice(0,80);
    if (cards.length) { result.formats.set(format,cards); result.counts.set(format,decks.size); result.playShares.set(format,new Map(cards.map(row=>[row.passcode,row.playShare]))); }
  }
  if (!cache.has(guildId) && cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(guildId,result); return result;
}
export function formatStaples(format = "normal", banlist?: string, db?: Database.Database, guildId?: string): FormatStaples {
  const key = stapleFormat(format,banlist), sample = artifact.formats[key as keyof typeof artifact.formats];
  const local = db && guildId ? savedUsage(db, guildId) : undefined, localCards = local?.formats.get(key);
  // A private cohort is an independent source. Public samples remain the stable default.
  const views = localCards ? local!.views : publicViews;
  const cached = views.get(key);
  if (cached) return cached;
  const cards = localCards ?? sample?.cards ?? [];
  const result: FormatStaples = { version: `${version}:${localCards ? local!.key : "public"}`, label: key === "tcg" ? "TCG" : key === "domain" ? "Domain" : key === "genesys" ? "Genesys" : key === "genesys-domain" ? "Genesys Domain" : "OCG", cards: new Map(cards.map(row=>[row.passcode,row])),
    playShares: localCards ? local!.playShares.get(key)! : new Map((sample?.genericUsage??[]).map(row=>[row.passcode,row.decks/sample!.deckCount])),
    archetypes: new Map(localCards ? [] : Object.entries(sample?.archetypeDeckCounts??{}).map(([name,decks])=>[compactEffectName(name),{decks,cards:new Map((sample?.archetypeUsage[name]??[]).map(row=>[row.passcode,row.decks]))}])) };
  views.set(key,result);
  return result;
}

/** Only labeled cohorts of at least three decks support a per-archetype percentage. */
export function archetypePlayShare(usage: FormatStaples, archetype: string, passcode: number): number | undefined {
  const sample=usage.archetypes.get(compactEffectName(archetype));
  return sample && sample.decks>=3 ? (sample.cards.get(passcode)??0)/sample.decks : undefined;
}
