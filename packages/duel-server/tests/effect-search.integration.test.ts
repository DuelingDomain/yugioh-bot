import Database from "better-sqlite3";
import { existsSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { createCardInsightService } from "@yugidraft/shared/services";
import { emptyCardQuery, type CardQuery } from "@yugidraft/shared/duels";
import { loadCardDatabase } from "../src/cards.js";
import { cardEffectIndex, cardReleaseIndex, createCardEffectIndex, createCanonicalEffectResolver, initializeCardEffectIndex } from "../src/card-effects.js";
import { queryCards } from "../src/card-search.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createHmac } from "node:crypto";
import { seedIdentity } from "./helpers/identity.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const supportCases = ["elemental hero", "elemntal hero"].flatMap(target => [
  ...["synergies", "synergy", "support", "supports", "combos", "partners", "staples", "deck", "related cards"].map(word => `${target} ${word}`),
  `cards for ${target}`, `what goes with ${target}`, `synergy with ${target}`,
]);
const descriptorSupportCases = [
  ['dragon deck', 'types', 'Dragon', 'The Melody of Awakening Dragon'],
  ['dragons deck', 'types', 'Dragon', 'The Melody of Awakening Dragon'],
  ['dark deck', 'attributes', 'DARK', 'Allure of Darkness'],
  ['light deck', 'attributes', 'LIGHT', 'Sage with Eyes of Blue'],
] as const;
const deckEffectCases = ['dark monsters that search the deck', 'dark monsters that shuffle deck'];

const effectCases: [string,string[],string[]][] = [
  ["hand traps that negate blorptastic", ["Effect Veiler", "Ash Blossom & Joyous Spring"], ["Raigeki"]],
  ["cards like Ash Blossom", ["Effect Veiler"], ["Ash Blossom & Joyous Spring", "Blue-Eyes White Dragon"]],
  ["similar to Effect Veiler", ["Ash Blossom & Joyous Spring"], ["Effect Veiler", "Blue-Eyes White Dragon"]],
  ["budget Ash Blossom", ["Effect Veiler"], ["Ash Blossom & Joyous Spring", "Blue-Eyes White Dragon"]],
  ["how to beat Snake-Eye", ["D.D. Crow"], ["Snake-Eye Ash", "Blue-Eyes White Dragon"]],
  ["counters to Kashtira", ["Gameciel, the Sea Turtle Kaiju"], ["Kashtira Fenrir", "Blue-Eyes White Dragon"]],
  ["stop Tearlaments", ["D.D. Crow", "Called by the Grave"], ["Tearlaments Scheiren", "Blue-Eyes White Dragon"]],
  ["1500 atk or less", ["Effect Veiler", "Ash Blossom & Joyous Spring"], ["Blue-Eyes White Dragon"]],
  ["atk 1500 or lower", ["Effect Veiler"], ["Blue-Eyes White Dragon"]],
  ["2500 attack or more", ["Dark Magician", "Blue-Eyes White Dragon"], ["Effect Veiler"]],
  ["attack 2500 or higher", ["Dark Magician"], ["Effect Veiler"]],
  ["hand traps before 2015", ["Effect Veiler", "D.D. Crow"], ["Ash Blossom & Joyous Spring", "Infinite Impermanence"]],
  ["GX era warriors", ["Elemental HERO Stratos"], ["Effect Veiler", "Blue-Eyes White Dragon", "Junk Synchron"]],
  ["2000 atk", ["Gene-Warped Warwolf"], ["Effect Veiler", "Blue-Eyes White Dragon"]],
  [
    "hand traps that negate",
    [
      "Ash Blossom & Joyous Spring",
      "Effect Veiler",
      "Infinite Impermanence"
    ],
    [
      "Blue-Eyes White Dragon",
      "Raigeki"
    ]
  ],
  [
    "handtrap that negates",
    [
      "Ash Blossom & Joyous Spring",
      "Effect Veiler"
    ],
    [
      "Dark Magician"
    ]
  ],
  [
    "banish from opponent's GY",
    [
      "Called by the Grave",
      "D.D. Crow"
    ],
    [
      "Effect Veiler",
      "Raigeki"
    ]
  ],
  [
    "banish from enemy GY",
    [
      "Called by the Grave",
      "D.D. Crow"
    ],
    [
      "Monster Reborn"
    ]
  ],
  [
    "level 4 tuner that searches",
    [
      "Scrap Raptor"
    ],
    [
      "Ash Blossom & Joyous Spring"
    ]
  ],
  [
    "lv 4 tuner that searches",
    [
      "Scrap Raptor"
    ],
    [
      "Effect Veiler"
    ]
  ],
  [
    "Spellcaster that negates",
    [
      "Effect Veiler"
    ],
    [
      "Ash Blossom & Joyous Spring"
    ]
  ],
  [
    "cards that negate quick effects and are spellcasters",
    [
      "Effect Veiler"
    ],
    [
      "Ash Blossom & Joyous Spring"
    ]
  ],
  [
    "floodgate",
    [
      "Skill Drain"
    ],
    [
      "Monster Reborn"
    ]
  ],
  [
    "draw cards",
    [
      "Pot of Greed",
      "Upstart Goblin"
    ],
    [
      "Raigeki",
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "destroy spells and traps",
    [
      "Mystical Space Typhoon",
      "Twin Twisters"
    ],
    [
      "Blue-Eyes White Dragon",
      "Effect Veiler"
    ]
  ],
  [
    "mill from deck",
    [
      "Foolish Burial"
    ],
    [
      "Dark Hole",
      "Effect Veiler"
    ]
  ],
  [
    "revive a monster",
    [
      "Monster Reborn",
      "Call of the Haunted"
    ],
    [
      "Raigeki"
    ]
  ],
  [
    "special summon a WATER monster from the GY",
    [
      "Monster Reborn",
      "Double Fin Shark"
    ],
    [
      "Raigeki"
    ]
  ],
  [
    "summon tokens",
    [
      "Scapegoat"
    ],
    [
      "Monster Reborn"
    ]
  ],
  [
    "return to hand",
    [
      "Compulsory Evacuation Device"
    ],
    [
      "Dark Hole"
    ]
  ],
  [
    "gain LP",
    [
      "Red Medicine"
    ],
    [
      "Dark Hole"
    ]
  ],
  [
    "fusion summon",
    [
      "Polymerization",
      "Super Polymerization"
    ],
    [
      "Mystical Space Typhoon"
    ]
  ],
  [
    "search field spells",
    [
      "Terraforming",
      "Planet Pathfinder"
    ],
    [
      "Dark Hole"
    ]
  ],
  [
    "banish monsters",
    [
      "D.D. Crow",
      "Called by the Grave"
    ],
    [
      "Effect Veiler"
    ]
  ],
  [
    "Blue-Eyes support",
    [
      "Sage with Eyes of Blue",
      "The White Stone of Legend"
    ],
    [
      "Dark Magician"
    ]
  ],
  [
    "blueeyes support",
    [
      "Sage with Eyes of Blue"
    ],
    [
      "Dark Magician"
    ]
  ],
  [
    "bule eyes support",
    [
      "Sage with Eyes of Blue"
    ],
    [
      "Dark Magician"
    ]
  ],
  [
    "buleeyes support",
    [
      "Sage with Eyes of Blue"
    ],
    [
      "Dark Magician"
    ]
  ],
  [
    "board breakers",
    [
      "Dark Ruler No More",
      "Forbidden Droplet"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "GY hate",
    [
      "D.D. Crow",
      "Called by the Grave"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "when this card is banished",
    [
      "Necroface"
    ],
    [
      "Raigeki"
    ]
  ],
  [
    "when this card is destroyed",
    [
      "Yubel"
    ],
    [
      "Raigeki"
    ]
  ],
  [
    "backrow removal",
    [
      "Mystical Space Typhoon",
      "Twin Twisters"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "tribute monsters",
    [
      "Lava Golem",
      "Gameciel, the Sea Turtle Kaiju"
    ],
    [
      "Raigeki"
    ]
  ],
  [
    "take control of opponent monsters",
    [
      "Mind Control",
      "Change of Heart"
    ],
    [
      "Dark Hole"
    ]
  ],
  [
    "normal summon again",
    [
      "Double Summon"
    ],
    [
      "Raigeki"
    ]
  ],
  [
    "change ATK",
    [
      "Shrink"
    ],
    [
      "Raigeki"
    ]
  ],
  [
    "piercing",
    [
      "Blue-Eyes Chaos MAX Dragon",
      "Cyber End Dragon"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "direct attack",
    [
      "Sky Striker Ace - Hayate"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "prevent targeting",
    [
      "Forbidden Dress"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "unaffected",
    [
      "Miscellaneousaurus"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "extenders",
    [
      "Monster Reborn"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "quick effect that negates",
    [
      "Effect Veiler",
      "Ash Blossom & Joyous Spring"
    ],
    [
      "Blue-Eyes White Dragon"
    ]
  ],
  [
    "add a Dragon to hand from deck",
    [
      "The Melody of Awakening Dragon"
    ],
    [
      "Dark Hole"
    ]
  ]
];
const nameCases: [string,string][] = [
  ["blueeyes spirit", "Blue-Eyes Spirit Dragon"],
  ["maskedhero dark", "Masked HERO Dark Law"],
  [
    "Ash Blossom",
    "Ash Blossom & Joyous Spring"
  ],
  [
    "Ash Blosom",
    "Ash Blossom & Joyous Spring"
  ],
  [
    "blue eyes white dragon",
    "Blue-Eyes White Dragon"
  ],
  [
    "blueeyes white dragon",
    "Blue-Eyes White Dragon"
  ],
  [
    "bule eyes white dragon",
    "Blue-Eyes White Dragon"
  ],
  [
    "dark magician",
    "Dark Magician"
  ],
  [
    "darkmagicain",
    "Dark Magician"
  ],
  [
    "raigeki",
    "Raigeki"
  ],
  [
    "effect veiler",
    "Effect Veiler"
  ],
  [
    "drak hole",
    "Dark Hole"
  ]
];
// Newest sort, five budgets, four formats, deck synergy, extra text and multi-attack.
const expectedQueries = effectCases.length + supportCases.length + descriptorSupportCases.length + deckEffectCases.length + nameCases.length + 15;
const cards = loadCardDatabase(engineDataDirectory);
const byName = new Map([...cards.all()].map(card => [card.name,card]));
const code = (name: string): number => { const card=byName.get(name); if (!card) throw new Error(`Eval card missing: ${name}`); return card.canonicalPasscode ?? card.code; };
const db = new Database(":memory:");
let host: DuelHost;
let playerId: number;
let evaluatedQueries=0, labeledTP=0, labeledFP=0, labeledFN=0, labeledTN=0;
const search = (text: string, pool?: number[], over: Partial<CardQuery> = {}) => queryCards(cards,{...emptyCardQuery(),text,limit:120,...(pool ? {passcodes:pool}:{}),...over});
const present = (result: ReturnType<typeof search>) => [...result.cards,...(result.effectHits??[])].map(card=>card.canonicalPasscode ?? card.code);
const checkLabels = (result: readonly number[], include: readonly string[], exclude: readonly string[], text: string) => {
  for (const name of include) {
    const found = result.includes(code(name));
    if (found) labeledTP++; else labeledFN++;
    expect(found, `${text}: missing ${name}`).toBe(true);
  }
  for (const name of exclude) {
    const found = result.includes(code(name));
    if (found) labeledFP++; else labeledTN++;
    expect(found, `${text}: unexpected ${name}`).toBe(false);
  }
};

beforeAll(() => {
  vi.stubEnv("EFFECT_SEARCH","1"); vi.stubEnv("ANTHROPIC_API_KEY", "");
  migrate(db); importCardEffectArtifact(db,{canonicalize:createCanonicalEffectResolver(cards)}); createCardEffectIndex(db,cards);
  // Actual engine metadata supplies the catalog used by SQL insights; no online API is involved.
  const insert=db.prepare(`INSERT OR IGNORE INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,atk,def,image_url,image_url_small,card_sets_json,cached_at,archetype,genesys_points,genesys_revision)
    VALUES(?,?,?,?,?,?,?,?,?,'','','[]',CURRENT_TIMESTAMP,?,0,'eval')`);
  for (const card of cards.all()) {
    if (card.canonicalPasscode && card.canonicalPasscode!==card.code) continue;
    insert.run(card.code,card.name,card.type&2?'Spell Card':card.type&4?'Trap Card':'Effect Monster',card.type&0x2000?'synchro':card.type&0x800000?'xyz':card.type&0x4000000?'link':'effect',card.description,'',card.level,card.attack,card.defense,card.name.includes('Blue-Eyes')?'Blue-Eyes':card.name.includes('Dark Magician')?'Dark Magician':null);
  }
  db.exec("INSERT INTO genesys_points_meta VALUES(1,'eval','2026-10-05','eval',CURRENT_TIMESTAMP)");
  playerId=seedIdentity(db,{guildId:'eval'}).playerId;
  host=createDuelHost({db,dataDirectory:engineDataDirectory,secret:'eval-secret',searchCards:()=>[],pollIntervalMs:60_000});
},20_000);

afterAll(async()=>{
  const report={queries:evaluatedQueries,expectedQueries,complete:evaluatedQueries===expectedQueries,labeledTP,labeledFP,labeledFN,labeledTN,
    labeledPrecision:labeledTP+labeledFP ? labeledTP/(labeledTP+labeledFP) : null,
    labeledRecall:labeledTP+labeledFN ? labeledTP/(labeledTP+labeledFN) : null};
  const output=resolve(import.meta.dirname,'../../../.status/effect-search');mkdirSync(output,{recursive:true});
  writeFileSync(resolve(output,'eval.json'),JSON.stringify(report,null,2)+'\n');
  console.info('EFFECT_EVAL',JSON.stringify(report));
  if(host)await host.close();db.close();cards.close();vi.unstubAllEnvs();
});

describe(`${expectedQueries}-query real-artifact effect/name/synergy/format evaluation`,()=>{
  it('installs a file-backed startup index with identical readings, dates and all-card effect scores', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'effect-facet-process-'));
    const path = resolve(directory, 'shared.sqlite');
    let disk: Database.Database | undefined;
    try {
      await db.backup(path);
      disk = new Database(path);
      const sync = createCardEffectIndex(disk, cards);
      const prepared = await initializeCardEffectIndex(disk, cards);
      expect(prepared.size).toBe(sync.size);
      expect(cardEffectIndex(cards)).toBe(prepared);
      const all = [...cards.all()];
      expect(all.map(card => prepared.release(card.code))).toEqual(all.map(card => sync.release(card.code)));
      expect(all.map(card => prepared.popularity(card.code))).toEqual(all.map(card => sync.popularity(card.code)));
      for (const text of [...effectCases.map(row => row[0]), 'newest spells', 'before 2010', 'Dark Magician']) {
        const reading = sync.readQuery(text);
        expect(prepared.readQuery(text), text).toEqual(reading);
        if (reading) expect(all.map(card => prepared.match(card.code, reading)), text).toEqual(all.map(card => sync.match(card.code, reading)));
      }
    } finally { createCardEffectIndex(db, cards); disk?.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
  it.each(effectCases)('effect: %s',(text,include,exclude)=>{
    evaluatedQueries++;
    const result=present(search(text,[...include,...exclude].map(code)));
    checkLabels(result,include,exclude,text);
  });
  it.each(['hand trap', 'hand traps'])('keeps the effect group for the full-catalog role query: %s', text => {
    const result = search(text);
    expect(result.effectSearchEnabled).toBe(true);
    expect(result.reading?.chips).toEqual(['Role: hand trap']);
    expect(result.cards).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.effectHits?.map(card => card.code)).toEqual(expect.arrayContaining([
      'Ash Blossom & Joyous Spring', 'Effect Veiler', 'Droll & Lock Bird', 'Ghost Ogre & Snow Rabbit',
    ].map(code)));
  });
  it.each(supportCases)('support phrase: %s', text => {
    evaluatedQueries++;
    const include = ['Elemental HERO Stratos', 'Elemental HERO Shadow Mist'];
    const exclude = ['Dark Magician', 'Blue-Eyes White Dragon'];
    const result = search(text, [...include, ...exclude].map(code));
    expect(result.reading?.query.supports?.archetypes).toEqual(['Elemental HERO']);
    expect(result.reading?.query.text).toBe('');
    expect(result.reading?.chips).toEqual(['Works with: "Elemental HERO"']);
    expect(result.cards).toEqual([]);
    expect(result.effectTotal).toBe(2);
    checkLabels((result.effectHits ?? []).map(card => card.code), include, exclude, text);
    const catalog = search(text);
    expect(catalog.reading?.query.supports?.archetypes).toEqual(['Elemental HERO']);
    expect(catalog.reading?.query.text).toBe('');
    expect(catalog.effectTotal).toBeGreaterThan(0);
    expect(catalog.effectHits?.length).toBeGreaterThan(0);
  });
  it('uses unknown words after support only as a soft boost', () => {
    evaluatedQueries++;
    const result = search('elemental hero synergies nonexistentword', ['Elemental HERO Stratos'].map(code));
    expect(result.reading?.query.supports?.archetypes).toEqual(['Elemental HERO']);
    expect(result.reading?.query.text).toBe('nonexistentword');
    expect(result.effectTotal).toBe(1);
  });
  it.each(descriptorSupportCases)('support descriptor: %s', (text, key, value, name) => {
    evaluatedQueries++;
    const result = search(text, [name, 'Raigeki'].map(code));
    expect(result.reading?.query.supports?.[key]).toEqual([value]);
    expect(result.reading?.query.supports?.archetypes).toEqual([]);
    expect(result.reading?.query.text).toBe('');
    checkLabels((result.effectHits ?? []).map(card => card.code), [name], ['Raigeki'], text);
  });
  it.each(deckEffectCases)('keeps card descriptors on ordinary effects: %s', text => {
    evaluatedQueries++;
    const reading = cardEffectIndex(cards)!.readQuery(text);
    expect(reading?.query.card.attributes).toEqual(['DARK']);
    expect(reading?.query.supports).toBeUndefined();
    expect(reading?.query.text).toBe('deck');
  });
  it('counts relaxations inside all outer filters and returns short card reasons', () => {
    evaluatedQueries++;
    const pool = ['Effect Veiler', 'Raigeki', 'Blue-Eyes White Dragon'].map(code);
    const result = search('hand traps that destroy', pool);
    expect(result.effectTotal).toBe(0);
    expect(result.relax).toEqual([{ chip: 'Does: destroy', count: 1 }, { chip: 'Role: hand trap', count: 1 }]);
    for (const hint of result.relax ?? []) {
      expect(search('hand traps that destroy', pool, { effectOmit: [hint.chip] }).effectTotal).toBe(hint.count);
    }
    expect(search('hand traps that destroy', pool, { kind: 'trap' }).relax).toEqual([]);
    const hits = search('hand traps that negate', pool).effectHits!;
    expect(hits[0].reason).toMatch(/negat/i);
    expect(hits.every(hit => hit.reason.length > 0 && hit.reason.length <= 70)).toBe(true);
    const boosted = search('hand traps veiler', ['Ash Blossom & Joyous Spring', 'Effect Veiler'].map(code));
    expect(boosted.effectTotal).toBe(2);
    expect(boosted.effectHits?.[0]?.name).toBe('Effect Veiler');
  });
  it('newest spells orders the retained page by release date', () => {
    evaluatedQueries++;
    const pool = ['Monster Reborn', 'Twin Twisters', 'Raigeki'].map(code);
    const result = search('newest spells', pool);
    expect(result.reading?.chips).toContain('Sort: newest first');
    expect(result.effectHits?.[0]?.name).toBe('Twin Twisters');
    expect(result.effectHits?.every(card => card.release?.date)).toBe(true);
    const names = search('', pool, { sort: 'newest', released: { to: '2005-12' } });
    expect(names.cards.map(card => card.name)).not.toContain('Twin Twisters');
    expect(names.cards.length).toBe(2);
    expect(search('between 2008 and 2010', ['Effect Veiler', 'Ash Blossom & Joyous Spring'].map(code)).effectHits?.map(card => card.name)).toEqual(['Effect Veiler']);
    const sql = createCardInsightService(db, { dataDirectory: engineDataDirectory });
    expect(sql.effectSearch('newest spells', pool).cards[0]?.passcode).toBe(code('Twin Twisters'));
    const baseline = cardEffectIndex(cards)!;
    const originalReleases = db.prepare("SELECT passcode,tcg_date FROM card_release WHERE passcode IN (?,?,?)").all(...pool) as { passcode: number; tcg_date: string | null }[];
    const originalPopularity = db.prepare("SELECT passcode,popularity FROM card_tags WHERE passcode IN (?,?,?)").all(...pool) as { passcode: number; popularity: number }[];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    try {
      for (const id of pool) db.prepare("UPDATE card_release SET tcg_date='2026-09' WHERE passcode=?").run(id);
      db.prepare("UPDATE card_release SET tcg_date='2026-10' WHERE passcode=?").run(code('Raigeki'));
      db.prepare("UPDATE card_tags SET popularity=CASE WHEN passcode=? THEN 999999999 ELSE 0 END WHERE passcode IN (?,?,?)").run(code('Twin Twisters'), ...pool);
      const updated = createCardEffectIndex(db, cards);
      for (const text of ['new cards', 'newest spells', 'newest spells 2']) {
        const result = search(text, pool).effectHits!;
        expect(result).toHaveLength(3);
        expect(result[0].name).toBe('Raigeki');
        for (let i = 1; i < result.length; i++) {
          const a = result[i - 1], b = result[i];
          expect(b.release!.date!.localeCompare(a.release!.date!) || updated.popularity(b.code) - updated.popularity(a.code) || b.score - a.score).toBeLessThanOrEqual(0);
        }
      }
      const scored = search('newest spells 2', pool).effectHits!;
      expect(scored.map(card => card.name)).toEqual(search('newest spells', pool).effectHits!.map(card => card.name));
      expect(search('', pool, { sort: 'newest' }).cards.map(card => card.name)).toEqual(['Raigeki', 'Twin Twisters', 'Monster Reborn']);
      expect(baseline.size).toBe(updated.size);
    } finally {
      for (const row of originalReleases) db.prepare('UPDATE card_release SET tcg_date=? WHERE passcode=?').run(row.tcg_date, row.passcode);
      for (const row of originalPopularity) db.prepare('UPDATE card_tags SET popularity=? WHERE passcode=?').run(row.popularity, row.passcode);
      createCardEffectIndex(db, cards); vi.useRealTimers();
    }
    expect(present(search('hand traps before 2015', ['Effect Veiler', 'Ash Blossom & Joyous Spring'].map(code), { effectOmit: ['Released: before 2015'] }))).toContain(code('Ash Blossom & Joyous Spring'));
  });
  it('keeps unknown months last and unmarked, and uses first set dates in both search services', () => {
    vi.stubEnv('EFFECT_SEARCH', '1');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    const known = code('Raigeki'), unknown = code('Field Power Bonus');
    const originals = db.prepare('SELECT * FROM card_release WHERE passcode IN (?,?)').all(known, unknown) as any[];
    try {
      db.prepare("UPDATE card_release SET tcg_date='2002-01',ocg_date='2026-12' WHERE passcode=?").run(known);
      db.prepare('DELETE FROM card_release WHERE passcode=?').run(unknown);
      createCardEffectIndex(db, cards);
      const pool = [known, unknown];
      const hits = search('new cards', pool).effectHits!;
      expect(hits.map(hit => hit.code)).toEqual([known]);
      const undated = search('newest spells', pool).effectHits!;
      expect(undated.at(-1)?.release).toMatchObject({ upcoming: false });
      expect(undated.at(-1)?.release?.date).toBeUndefined();
      expect(hits[0].release).toMatchObject({ date: '2026-12', region: 'ocg', upcoming: true });
      expect(search('new cards TCG', pool).effectHits).toEqual([]);
      const sql = createCardInsightService(db, { dataDirectory: engineDataDirectory });
      expect(sql.effectSearch('new cards', pool).cards.map(card => card.passcode)).toEqual([known]);
      expect(cardReleaseIndex(db, cards).get(unknown)?.upcomingDate).toBeUndefined();
      const god = code('The Immortal Sun God');
      // A known engine pre-release leads a later regional debut of an already printed card.
      for (const text of ['new cards', 'newest spells']) {
        expect(search(text, [known, god]).effectHits!.map(card => card.code)).toEqual([god, known]);
        expect(sql.effectSearch(text, [known, god]).cards.map(card => card.passcode)).toEqual([god, known]);
      }
      expect(search('', [known, god], { sort: 'newest' }).cards.map(card => card.code)).toEqual([god, known]);
      expect(search('new cards', [god]).effectHits![0].release).toMatchObject({ date: '2026-10', upcoming: true });
      const sameMonth = ['The Great Gallant Bandit', 'Verre, the Maid of Endymion'].map(code);
      // Preserve the engine's original set order after temporary IDs become official passcodes.
      expect(search('new cards', sameMonth).effectHits!.map(card => card.code)).toEqual(sameMonth);
      expect(sql.effectSearch('new cards', sameMonth).cards.map(card => card.passcode)).toEqual(sameMonth);
      db.prepare("INSERT INTO card_sets(set_name,set_code,card_count,synced_at,release_date) VALUES('Release integration set','REL',1,CURRENT_TIMESTAMP,'2026-11-01')").run();
      db.prepare("INSERT INTO card_sets(set_name,set_code,card_count,synced_at,release_date) VALUES('Earlier promo with reused code','REL',1,CURRENT_TIMESTAMP,'2002-01-01')").run();
      db.prepare('UPDATE card_catalog SET card_sets_json=? WHERE ygoprodeck_id=?').run(JSON.stringify([{ set_name: 'Release integration set', set_code: 'REL-EN001' }]), unknown);
      expect(cardReleaseIndex(db, cards).get(unknown)?.upcomingDate).toBe('2026-11');
      expect(search('newest spells', pool).effectHits!.map(card => card.code)).toEqual([unknown, known]);
      expect(search('new cards', pool).effectHits![0].release).toMatchObject({ date: '2026-11', upcoming: true });
      expect(sql.effectSearch('new cards', pool).cards[0].release).toMatchObject({ date: '2026-11', upcoming: true });
      db.prepare("UPDATE card_sets SET release_date='2020-01-01' WHERE set_code='REL'").run();
      expect(search('new cards', pool).effectHits!.map(hit => hit.code)).toEqual([known]);
      expect(search('newest spells', [unknown]).effectHits![0].release).toMatchObject({ date: '2020-01', upcoming: false });
      db.prepare("UPDATE card_sets SET release_date='2026-11-01' WHERE set_code='REL'").run();
      expect(cardReleaseIndex(db, cards).get(unknown)?.upcomingDate).toBe('2026-11');
      vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
      expect(cardReleaseIndex(db, cards).get(unknown)?.upcomingDate).toBe('2026-11');
      db.prepare("UPDATE card_release SET tcg_date='2026-10',ocg_date=NULL WHERE passcode=?").run(known);
      createCardEffectIndex(db, cards);
      expect(search('newest spells', [known, god]).effectHits![0].code).toBe(god);
      expect(sql.effectSearch('newest spells', [known, god]).cards[0].passcode).toBe(god);
      const extra = db.prepare('SELECT card_sets_json FROM card_catalog WHERE ygoprodeck_id=?').get(known) as { card_sets_json: string };
      try {
        db.prepare("UPDATE card_sets SET release_date='2003-01-01' WHERE set_code='REL'").run();
        db.prepare('UPDATE card_catalog SET card_sets_json=? WHERE ygoprodeck_id=?').run(JSON.stringify([{ set_name: 'Release integration set', set_code: 'REL-001' }]), known);
        expect(search('newest TCG spells', [known]).effectHits![0].release?.date).toBe('2003-01');
        expect(sql.effectSearch('newest TCG spells', [known]).cards[0].release?.date).toBe('2003-01');
        expect(cardReleaseIndex(db, cards).get(known)?.tcgDate).toBe('2003-01');
      } finally { db.prepare('UPDATE card_catalog SET card_sets_json=? WHERE ygoprodeck_id=?').run(extra.card_sets_json, known); }
    } finally {
      db.prepare('DELETE FROM card_release WHERE passcode IN (?,?)').run(known, unknown);
      const insert = db.prepare('INSERT INTO card_release(passcode,tcg_date,ocg_date,quality,source_version) VALUES(@passcode,@tcg_date,@ocg_date,@quality,@source_version)');
      for (const row of originals) insert.run(row);
      db.prepare("DELETE FROM card_sets WHERE set_code='REL'").run();
      db.prepare("UPDATE card_catalog SET card_sets_json='[]' WHERE ygoprodeck_id=?").run(unknown);
      createCardEffectIndex(db, cards); vi.useRealTimers();
    }
  });
  it.each(nameCases)('name/alias/typo: %s',(text,name)=>{
    evaluatedQueries++;
    const catalog=search(text,undefined,{scope:'all'});
    expect(catalog.reading).toBeNull();
    const names=present(search(text,undefined,{scope:'name'})), all=catalog.cards.map(card=>card.canonicalPasscode ?? card.code);
    checkLabels(names.filter(passcode=>all.includes(passcode)),[name],[],`${text} in both scopes`);
  });
  it.each([0,20,29,30,40])('Genesys budget %s excludes unknown/Link/Pendulum',(budget)=>{
    evaluatedQueries++;
    const pool=['Effect Veiler','Ash Blossom & Joyous Spring','Linkuriboh','Luster Pendulum, the Dracoslayer','PSY-Framegear Gamma'].map(code);
    const points=new Map([[code('Effect Veiler'),0],[code('Ash Blossom & Joyous Spring'),30],[code('Linkuriboh'),0],[code('Luster Pendulum, the Dracoslayer'),0]]);
    const result=queryCards(cards,{...emptyCardQuery(),text:'hand traps that negate',passcodes:pool,excludeGenesysForbidden:true,genesysPoints:{min:null,max:budget}},undefined,points);
    checkLabels(present(result),['Effect Veiler',...(budget>=30?['Ash Blossom & Joyous Spring']:[])],
      ['Linkuriboh','Luster Pendulum, the Dracoslayer','PSY-Framegear Gamma',...(budget<30?['Ash Blossom & Joyous Spring']:[])],`Genesys budget ${budget}`);
  });
  it.each(['normal','domain','genesys','genesys-domain'] as const)('single-card synergy %s',(format)=>{
    evaluatedQueries++;
    const insights=createCardInsightService(db,{dataDirectory:engineDataDirectory});
    const found=insights.suggestForDeck([code('Blue-Eyes White Dragon')],{format,pool:['Sage with Eyes of Blue','Dark Magician'].map(code),deckMaster:code('Blue-Eyes White Dragon'),genesysRemaining:0});
    checkLabels(found.map(card=>card.passcode),['Sage with Eyes of Blue'],['Dark Magician'],`${format} single-card synergy`);
  });
  it('deck synergy ranks by distinct linked deck cards',()=>{
    evaluatedQueries++;
    const insights=createCardInsightService(db,{dataDirectory:engineDataDirectory});
    const found=insights.suggestForDeck([code('Blue-Eyes White Dragon'),code('Dark Magician')],{format:'normal',pool:['Sage with Eyes of Blue','Eternal Soul','Raigeki'].map(code)});
    checkLabels(found.map(card=>card.passcode),['Sage with Eyes of Blue','Eternal Soul'],['Raigeki'],'deck synergy');
  });
});

it('signed host card-query keeps name hits separate, supports pool/chip/exact/flag controls and guild scope',async()=>{
  const post=async(guildId:string,cardQuery:object)=>{
    const body=JSON.stringify({op:'card-query',guildId,playerId,cardQuery});
    return host.handle(new Request('http://local/internal/duel',{method:'POST',body,headers:{ 'x-announce-signature': 'sha256=' + createHmac('sha256', 'eval-secret').update(body).digest('hex') }}));
  };
  const pool=['Ash Blossom & Joyous Spring','Effect Veiler','Blue-Eyes White Dragon'].map(code);
  const response=await post('eval',{text:'hand traps that negate',passcodes:pool});expect(response.status).toBe(200);
  const result=await response.json();expect(result.cards).toEqual([]);expect(result.effectHits.map((card:any)=>card.code)).toEqual(expect.arrayContaining(['Ash Blossom & Joyous Spring','Effect Veiler'].map(code)));
  expect(result.reading.chips).toContain('Role: hand trap');
  const artwork=await (await post('eval',{text:'revive a monster',passcodes:[83764719]})).json();expect(artwork.effectHits.map((card:any)=>card.code)).toContain(code('Monster Reborn'));
  const compact=search('blueeyes',undefined,{scope:'name'});expect(compact.total).toBeGreaterThan(1);expect(compact.cards.map(card=>card.name)).toContain('Blue-Eyes White Dragon');
  const typo=await (await post('eval',{text:'dark magicain'})).json();expect(typo.cards.map((card:any)=>card.name)).toContain('Dark Magician');expect(typo.reading).toBeNull();
  const exact=await (await post('eval',{text:'hand traps that negate',passcodes:pool,exact:true})).json();expect(exact.reading).toBeNull();expect(exact.effectHits).toEqual([]);
  const omitted=await (await post('eval',{text:'hand traps that negate',passcodes:pool,effectOmit:['Role: hand trap']})).json();expect(omitted.reading.chips).not.toContain('Role: hand trap');
  const dated=await (await post('eval',{text:'hand traps before 2015',passcodes:pool})).json();
  expect(dated.effectHits.map((card:any)=>card.code)).toEqual([code('Effect Veiler')]);
  expect((await post('eval',{released:{from:'2015-13'}})).status).toBe(400);
  expect((await post('',{text:'Ash Blossom'})).status).toBe(400);
  vi.stubEnv('EFFECT_SEARCH','0');const off=await (await post('eval',{text:'hand traps that negate'})).json();expect(off.effectSearchEnabled).toBe(false);expect(off.effectHits).toBeUndefined();
});

it('keeps multi-attack text out of ATK stat filters', () => {
  evaluatedQueries++;
  const reading = cardEffectIndex(cards)!.readQuery('attack 2 times');
  expect(reading?.query.card.atkMin).toBeUndefined();
  expect(reading?.query.card.atkMax).toBeUndefined();
});

it('sorts and filters dates with effect search off without installing effect facets', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'effect-off-dates-'));
  for (const file of ['cards.cdb', 'strings.conf', 'manifest.json', 'card-remaps.json']) {
    const source = resolve(engineDataDirectory, file);
    if (existsSync(source)) cpSync(source, resolve(directory, file));
  }
  mkdirSync(resolve(directory, 'card-scripts'));
  const isolatedCards = loadCardDatabase(directory);
  const isolatedHost = createDuelHost({ db, dataDirectory: directory, secret: 'off-secret', searchCards: () => [], pollIntervalMs: 60000 });
  vi.stubEnv('EFFECT_SEARCH', '0');
  try {
    expect(cardEffectIndex(isolatedCards)).toBeUndefined();
    const post = async (cardQuery: object) => {
      const body = JSON.stringify({ op: 'card-query', guildId: 'eval', playerId, cardQuery });
      const response = await isolatedHost.handle(new Request('http://local/internal/duel', { method: 'POST', body,
        headers: { 'x-announce-signature': 'sha256=' + createHmac('sha256', 'off-secret').update(body).digest('hex') } }));
      expect(response.status).toBe(200);
      return response.json();
    };
    const passcodes = ['Monster Reborn', 'Twin Twisters', 'Raigeki'].map(code);
    const sorted = await post({ text: '', passcodes, sort: 'newest' });
    expect(sorted.effectSearchEnabled).toBe(false);
    expect(sorted.cards[0].name).toBe('Twin Twisters');
    expect(sorted.cards[0].release.date).toBeTruthy();
    const filtered = await post({ text: '', passcodes, released: { to: '2005-12' } });
    expect(filtered.cards).toHaveLength(2);
    expect(filtered.cards.map((card: { name: string }) => card.name)).not.toContain('Twin Twisters');
    expect(cardEffectIndex(isolatedCards)).toBeUndefined();
  } finally { await isolatedHost.close(); isolatedCards.close(); rmSync(directory, { recursive: true, force: true }); }
});


it('evaluates a hard phrase through one mocked Messages POST against real artifact tags', async () => {
  evaluatedQueries++;
  vi.stubEnv('EFFECT_SEARCH', '1');
  const { createServer } = await import('node:http');
  const { fallbackEffectReading } = await import('@yugidraft/shared/cards/effects/reading-fallback');
  const { createEmptyLedger, validateLedger } = await import('@yugidraft/shared/cards/effects/budget-ledger');
  let ledger = createEmptyLedger(), revision = '0', posts = 0;
  const store: import("@yugidraft/shared/cards/effects/budget-ledger").LedgerStore = {
    read: async () => ({ revision, ledger: structuredClone(ledger) }),
    compareAndSwap: async (previous, next) => { if (previous !== revision) throw new Error('CAS'); ledger = structuredClone(validateLedger(next)); revision = String(Number(revision) + 1); return revision; },
  };
  const phrase = 'end their combo before it begins';
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* Mock the paid endpoint, never use a real key. */ }
    posts++;
    response.end(JSON.stringify({ id: 'msg_eval', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify(cardEffectIndex(cards)!.readQuery('hand traps that negate')!.query) }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    expect(await fallbackEffectReading(db, phrase, 'eval-user', { store, apiKey: 'mock', baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true })).not.toBeNull();
    const pool = ['Effect Veiler', 'Ash Blossom & Joyous Spring', 'Raigeki'].map(code);
    const first = search(phrase, pool), again = search(phrase, pool);
    checkLabels(present(first), ['Effect Veiler', 'Ash Blossom & Joyous Spring'], ['Raigeki'], phrase);
    expect(first.effectHits?.map(card => card.reason)).toEqual(again.effectHits?.map(card => card.reason));
    expect(first.effectHits?.every(card => card.reason.length > 0 && card.reason.length <= 70)).toBe(true);
    expect(posts).toBe(1);
  } finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); }
});

it('keeps similarity and counter matches within outer pool, type, banlist and Genesys filters in both services', () => {
  vi.stubEnv('EFFECT_SEARCH', '1');
  const points = new Map([[code('Effect Veiler'), 0], [code('Ash Blossom & Joyous Spring'), 30]]);
  const pool = ['Effect Veiler', 'Ash Blossom & Joyous Spring', 'Blue-Eyes White Dragon'].map(code);
  const input = { ...emptyCardQuery(), text: 'cards like Ash Blossom', passcodes: pool, excludeGenesysForbidden: true, genesysPoints: { min: null, max: 0 } };
  expect(queryCards(cards, input, undefined, points).effectHits?.map(card => card.code)).toEqual([code('Effect Veiler')]);
  expect(queryCards(cards, { ...input, kind: 'spell' }, undefined, points).effectTotal).toBe(0);
  expect(queryCards(cards, { ...input, passcodes: [] }, undefined, points).effectTotal).toBe(0);
  expect(queryCards(cards, { ...input, banlist: 'tcg-2026-09', limits: ['forbidden'] }, undefined, points).effectTotal).toBe(0);
  expect(search('stop Tearlaments', ['D.D. Crow'].map(code), { kind: 'spell' }).effectTotal).toBe(0);
  const sql = createCardInsightService(db, { dataDirectory: engineDataDirectory });
  for (const format of ['normal', 'domain', 'genesys', 'genesys-domain'] as const) {
    expect(sql.effectSearch('similar to Ash Blossom', pool, { format, genesysRemaining: 0 }).cards.map(card => card.passcode)).toContain(code('Effect Veiler'));
    const counters = sql.effectSearch('stop Tearlaments', ['D.D. Crow', 'Tearlaments Scheiren', 'Blue-Eyes White Dragon'].map(code), { format, genesysRemaining: 0 });
    expect(counters.cards.map(card => card.passcode)).toEqual([code('D.D. Crow')]);
    expect(counters.cards[0].reason.length).toBeLessThanOrEqual(70);
  }
  const relaxed = sql.effectSearch('hand traps that destroy', ['Effect Veiler', 'Raigeki', 'Blue-Eyes White Dragon'].map(code));
  expect(relaxed.relax).toEqual([{ chip: 'Does: destroy', count: 1 }, { chip: 'Role: hand trap', count: 1 }]);
  for (const hint of relaxed.relax!) expect(sql.effectSearch('hand traps that destroy', ['Effect Veiler', 'Raigeki', 'Blue-Eyes White Dragon'].map(code), { omittedChips: [hint.chip] }).total).toBe(hint.count);
});


it('does no artifact or tag writes at duel boot with EFFECT_SEARCH off', async () => {
  const { initializeServerCardEffects } = await import('../src/card-effect-startup.js');
  const isolated = new Database(':memory:'); migrate(isolated);
  vi.stubEnv('EFFECT_SEARCH', '0');
  try {
    const before = isolated.prepare('SELECT total_changes() AS changes').get();
    // A missing artifact/engine directory must not matter when the flag is off.
    await initializeServerCardEffects(isolated, cards, '/missing-effect-startup-directory');
    expect(isolated.prepare('SELECT total_changes() AS changes').get()).toEqual(before);
    for (const table of ['card_tags', 'card_tag_profiles', 'card_tag_artifact_imports']) {
      expect(isolated.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  } finally { vi.unstubAllEnvs(); isolated.close(); }
});
