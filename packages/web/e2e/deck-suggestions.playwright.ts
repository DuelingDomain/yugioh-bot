/**
 * Browser proof for the deck editor Suggestions rows: inline above the card list while the search box is empty.
 *
 * Real parts: the whole deck editor (SavedDeckEditor, bundled from src with vite) and the real card data from
 * cards.cdb. Stand-ins: Discord sign-in, the web API routes (the deck, the card list, the card details and
 * the suggestion service, each answered here from a fixed fixture), next/navigation and card art (cached art
 * when CARD_IMAGE_CACHE_DIR has it, otherwise a labelled placeholder).
 *
 * Run (Node 22, shared built, engine data in data/duel-engine):
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs SUGGESTIONS_ARTIFACTS=/tmp/deck-suggestions \
 *   DUEL_DATA_DIR=/path/to/data/duel-engine CARD_IMAGE_CACHE_DIR=/path/to/data/card-images \
 *     node --import tsx packages/web/e2e/deck-suggestions.playwright.ts
 * Exits 1 when any check fails; screenshots and evidence.json are written either way.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";

const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright")).href);
const e2e = fileURLToPath(new URL(".", import.meta.url));
const web = resolve(e2e, "..");
const repo = resolve(web, "../..");
const out = resolve(process.env.SUGGESTIONS_ARTIFACTS ?? "/tmp/deck-suggestions");
const dataDirectory = resolve(process.env.DUEL_DATA_DIR ?? join(repo, "data/duel-engine"));
const imageCache = process.env.CARD_IMAGE_CACHE_DIR;
const ORIGIN = "http://suggestions.harness";
await mkdir(out, { recursive: true });

// ---- Fixture: a Blue-Eyes style deck and the rows the service would answer -----------------------
const cardDb = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
const byName = cardDb.prepare<[string], { id: number }>("select d.id from datas d join texts t on t.id = d.id where t.name = ? and d.alias = 0");
function id(name: string): number {
  const row = byName.get(name);
  if (!row) throw new Error(`cards.cdb has no card named ${name}`);
  return row.id;
}
const cardRow = cardDb.prepare<[number], Record<string, number | string>>(
  "select d.id as code, d.alias, cast(d.setcode as text) as setcode, d.type, d.atk as attack, d.def as defense, d.level, d.race, d.attribute, d.ot, t.name, t.desc as description from datas d join texts t on t.id = d.id where d.id = ?");
function details(code: number) {
  const row = cardRow.get(code);
  if (!row) return null;
  const level = Number(row.level);
  const scales = level >> 16;
  // The four 16-bit groups of the setcode column, as the card API sends them.
  const setcodes = [0n, 16n, 32n, 48n].map((shift) => Number((BigInt(row.setcode) >> shift) & 0xffffn)).filter((value) => value > 0);
  return { code, canonicalPasscode: code, name: row.name, description: row.description, type: row.type, attack: row.attack, defense: row.defense, level: level & 0xffff, attribute: row.attribute, race: "Dragon", alias: 0, setcodes, lscale: scales >> 8, rscale: scales & 0xff, arrows: 0, ot: row.ot, altArtCount: 0 };
}

const MAIN_NAMES = ["Blue-Eyes White Dragon", "Sage with Eyes of Blue", "Dragon Spirit of White", "Maxx \"C\"", "Ash Blossom & Joyous Spring", "Effect Veiler",
  "Ghost Ogre & Snow Rabbit", "Terraforming", "The Melody of Awakening Dragon", "Dragon Shrine", "Silver's Cry", "Monster Reborn",
  "Foolish Burial", "Called by the Grave", "Infinite Impermanence", "Solemn Strike", "Blue-Eyes Spirit Dragon", "Blue-Eyes Chaos Dragon", "Blue-Eyes Solid Dragon", "Blue-Eyes Abyss Dragon"];
const small = MAIN_NAMES.map(id);
/** 20 cards, then the same 20 plus 20 more copies: over the 40-card line for the Extra Deck row. */
const SMALL_DECK = { main: small, extra: [], side: [] };
const FULL_DECK = { main: [...small, ...small], extra: [id("Blue-Eyes Ultimate Dragon")], side: [] };

const REASONS = {
  jet: "Summons itself from the hand when you control a Blue-Eyes monster, then helps your opponent's board stay empty.",
  alt: "Searched by Sage with Eyes of Blue and fills the Main Deck with another Level 8 Normal-like body.",
  phantom: "A second White Dragon that reuses your Dragon Spirit of White and Silver's Cry lines.",
  burst: "Pairs with Blue-Eyes White Dragon: a one-card board wipe once your dragons are on the field.",
  matched: "Stops a big opposing turn by forcing both players to discard to the same hand size.",
  cyclone: "Clears one Spell or Trap. Cheap, and it fits any deck that wants to remove backrow.",
  nibiru: "Punishes a long chain of Summons by tributing your opponent's board; your own Dragons stay safe.",
  ultimate: "Three Blue-Eyes White Dragon become one 4500 ATK Fusion Monster. Your Main Deck has all three materials.",
  tyrant: "Needs one Blue-Eyes plus one other Dragon; your Main Deck already holds both.",
  twin: "Needs Blue-Eyes White Dragon and one more Dragon; fits the cards you play now.",
  neo: "Needs Blue-Eyes Ultimate Dragon on the field; your Extra Deck already holds it.",
  pot: "Draws two cards for one banished pair of cards; the usual first pick in this format.",
  imperm: "A flexible answer that negates a monster effect or turns off a column of cards.",
  dark: "Destroys every monster on the field when you are losing the board.",
  solemn: "Negates a Summon or an activation, which keeps your Dragons safe from a combo.",
};
const ROW_FIXTURE = (mainCards: number) => [
  { id: "archetype", state: "ready", cards: [["Blue-Eyes Jet Dragon", REASONS.jet], ["Blue-Eyes Alternative White Dragon", REASONS.alt], ["Blue-Eyes White Dragon, the White Phantom Beast", REASONS.phantom]] },
  { id: "outside", state: "ready", cards: [["Burst Stream of Destruction", REASONS.burst], ["Evenly Matched", REASONS.matched], ["Cosmic Cyclone", REASONS.cyclone], ["Nibiru, the Primal Being", REASONS.nibiru]] },
  mainCards >= 40
    ? { id: "extra", state: "ready", cards: [["Blue-Eyes Twin Burst Dragon", REASONS.twin], ["Blue-Eyes Tyrant Dragon", REASONS.tyrant], ["Neo Blue-Eyes Ultimate Dragon", REASONS.neo], ["Blue-Eyes Alternative Ultimate Dragon", REASONS.ultimate]] }
    : { id: "extra", state: "hint", minimumMainCards: 40, mainCards, hint: "Add 40 Main Deck cards to see what your deck can make", cards: [] },
  { id: "staples", state: "ready", cards: [["Pot of Prosperity", REASONS.pot], ["Infinite Impermanence", REASONS.imperm], ["Dark Hole", REASONS.dark], ["Solemn Judgment", REASONS.solemn], ["Pot of Extravagance", REASONS.pot], ["Mirror Force", REASONS.solemn]] },
].map((row) => ({ ...row, cards: row.cards.map(([name, reason]) => ({ passcode: id(name as string), reason, score: 1, linkedCards: 2 })) }));

/** Limited, Semi-Limited and Forbidden marks, on every list id. */
const LIMITS: Record<number, 0 | 1 | 2> = { [id("Pot of Extravagance")]: 0, [id("Dark Hole")]: 1, [id("Infinite Impermanence")]: 2, [id("Maxx \"C\"")]: 2 };
/** Blue-Eyes (setcode 0xdd) is the deck archetype, so the Bridges row has a source. */
const FACETS = { archetypes: [{ name: "Blue-Eyes", codes: [0xdd], count: 38 }], banlists: Object.fromEntries(DUEL_BANLIST_OPTIONS.map((option) => [option.id, LIMITS])) };


// ---- Bridges: judged bridges as the web API returns them -------------------------------------------------
const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");
type FixtureBridge = ReturnType<typeof bridge>;
function bridge(source: string, target: string, grade: "Strong" | "Good" | "Niche" | "Risky", score: number, twoWay: boolean, cardNames: string[], line: string[], pros: string[], cons: string[], lock: string, warnings: string[] = [], genesysPoints: number | null = null) {
  return { source, target, format: "advanced", score, raw_score: score + 2, target_mean: 2, two_way: twoWay, grade,
    reasons: cardNames.map((name) => ({ key: "link", weight: 1, cards: [id(name)], evidence: [`${name} connects ${source} and ${target}.`], description: `${name} connects ${source} and ${target}.` })),
    cards: cardNames.map(id), warnings, genesys_points: genesysPoints, validation: "deterministic", judge: "accepted", engine_status: "unverified", evidence_hash: hashOf(`${source}>${target}`),
    review: { grade: grade.toLowerCase() as "strong" | "good" | "niche" | "risky", pros, cons, lock_note: lock, line } };
}
const BRIDGES: FixtureBridge[] = [
  bridge("Blue-Eyes", "Dragunity", "Strong", 86, true, ["Sage with Eyes of Blue", "Dragon Shrine", "Dragunity Phalanx", "Dragunity Dux"],
    ["Sage with Eyes of Blue", "Dragon Shrine", "Dragunity Phalanx"],
    ["Your Dragon Shrine already sends the Dragons Dragunity wants.", "Both sides reuse the same Level 4 starters."], ["Needs three more Winged Beast Normal-like slots.", "Dragunity monsters are weak on their own."],
    "No summon lock: you can summon from the Extra Deck after the line."),
  bridge("Blue-Eyes", "Dragon Ruler", "Good", 72, false, ["Redox, Dragon Ruler of Boulders", "Tidal, Dragon Ruler of Waterfalls", "Dragon Shrine", "Foolish Burial"],
    ["Foolish Burial", "Tidal, Dragon Ruler of Waterfalls", "Dragon Shrine"],
    ["Foolish Burial sets up both archetypes with one card.", "Tidal gives a graveyard Dragon to Dragon Shrine."], ["The Rulers need many cards in the Graveyard first.", "It does not lead back into Blue-Eyes."],
    "Once per turn Special Summon from the Ruler line is allowed with no lock."),
  bridge("Blue-Eyes", "Chaos", "Niche", 51, false, ["Chaos Sorcerer", "Chaos Emperor Dragon - Envoy of the End", "Black Luster Soldier - Envoy of the Beginning", "Monster Reborn"],
    ["Monster Reborn", "Chaos Sorcerer", "Black Luster Soldier - Envoy of the Beginning"],
    ["Monster Reborn revives the Chaos monster you banish for.", "Fits a Dragon deck that plays Light and Dark monsters."], ["Banishing your own Dragons costs card advantage.", "Hard to start with only a few Chaos monsters."],
    "A banished Chaos line limits you from using the Graveyard afterwards.", ["Chaos Emperor Dragon - Envoy of the End is Forbidden in the TCG list."]),
  bridge("Blue-Eyes", "Red-Eyes", "Risky", 38, true, ["Red-Eyes Black Dragon", "Red-Eyes Fusion", "Polymerization", "Red-Eyes Dark Dragoon"],
    ["Polymerization", "Red-Eyes Fusion", "Red-Eyes Dark Dragoon"],
    ["Both archetypes share Polymerization effects.", "Red-Eyes Black Dragon is a Dragon and works with Dragon Shrine."], ["Needs a Red-Eyes Normal Monster you do not play now.", "Slow without both Fusion spells."],
    "You can not Special Summon from the Extra Deck except Fusion Monsters.", ["Red-Eyes Fusion locks your Special Summons for the turn."], 6),
  bridge("Blue-Eyes", "Dark Magician", "Niche", 33, false, ["Dark Magician", "Magician of Black Chaos", "Polymerization"],
    ["Polymerization", "Dark Magician", "Magician of Black Chaos"],
    ["Polymerization reaches both Fusion lines.", "Dark Magician is a flexible Normal Summon."], ["Few shared cards beyond Polymerization.", "Its extra monsters have no use in a Dragon deck."],
    "No summon lock."),
  bridge("Dragunity", "Blue-Eyes", "Good", 70, true, ["Dragon Spirit of White", "Dragon Shrine", "Dragunity Phalanx"], ["Dragunity Phalanx", "Dragon Shrine", "Dragon Spirit of White"],
    ["Dragon Shrine sends Dragons both ways.", "Dragon Spirit of White is a Level 1 Dragon Tuner."], ["Needs Blue-Eyes monsters in the Main Deck.", "Few cards in common."], "No summon lock."),
  bridge("Dragunity", "Chaos", "Good", 61, false, ["Chaos Sorcerer", "Dragunity Dux"], ["Dragunity Dux", "Chaos Sorcerer"], ["Both play Dragons and Light monsters.", "Dux can be a Chaos banish cost."], ["It does not lead back.", "Few cards in common."], "No summon lock."),
];
const ARCHETYPE_NAMES = ["Blue-Eyes", "Chaos", "Dark Magician", "Dragon Ruler", "Dragunity", "Red-Eyes"];
const known = (name: string) => ARCHETYPE_NAMES.find((entry) => entry.toLowerCase() === name.trim().toLowerCase());
const asFormat = (list: FixtureBridge[], format: string) => list.map((entry) => ({ ...entry, format, ...(format === "genesys" ? { genesys_points: entry.genesys_points ?? 4 } : {}) }));

// ---- Request log and answer control ---------------------------------------------------------------
const insightRequests: { deck: { main: number[] }; pool?: number[]; at: number }[] = [];
const control = { delayMs: 0, emptyRows: false, deck: "small" as "small" | "full" | "empty", genesys: false, mode: "normal" as "normal" | "domain" };
/** Bridges: every call the row made, and how the stand-in host should answer. */
const bridgeCalls = { lists: [] as string[], starts: [] as Record<string, unknown>[], polls: 0, feedback: [] as Record<string, unknown>[], archetypes: 0 };
const bridgeControl = { listStatus: 200, none: false, pollDelayMs: 0, startRetryAfter: 0, jobMode: "ok" as "ok" | "fail", reviewCount: 3, feedbackFails: false, started: 0, deepNone: false,
  /** The deep search on Blue-Eyes + Dragunity finds Melodious (not in the fast list) and drops Dragon Ruler. */
  deepExtra: false,
  /** A status the host answers a join-only request with (404 or 409), or 0. */
  joinStatus: 0,
  /** That search has stored its rows, so the fast answer for the set holds Melodious too, as the host's does. */
  storedExtra: false,
  /** The next polls answer 503 busy, as a host does while this player has another projection in flight. */
  pollBusy: 0 };
/** Engines: the calls of the fast operation, and how the stand-in host detects the deck. */
const engineCalls: Record<string, any>[] = [];
const multiJobs = new Map<string, ReturnType<typeof enginesAnswer>>();
const engineControl = { mode: "single" as "single" | "multi" | "none", status: 200, delayMs: 0, nextEmpty: false };
/** The stand-in host's deep jobs: one per search (engines and format, or source), shared like the host shares them. */
const deepJobs = new Map<string, { id: string; done: boolean }>();
const deepWork = (body: any) => body.engines?.length > 1 ? JSON.stringify(["multi", [...body.engines].map((name: string) => name.toLowerCase()).sort(), body.format ?? "advanced"]) : JSON.stringify([String(body.engines?.[0] ?? body.source ?? "").toLowerCase(), body.target ?? "", body.format ?? "advanced"]);
const GRADE_ORDER = ["Strong", "Good", "Niche", "Risky"];
const json = (status: number, data: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(data) });

function cardImage(code: string) {
  const cached = imageCache ? join(imageCache, `${code}-small.jpg`) : null;
  if (cached && existsSync(cached)) return { status: 200, contentType: "image/jpeg", body: readFileSync(cached) };
  const name = String(cardRow.get(Number(code))?.name ?? code).replace(/[<&>]/g, "").slice(0, 22);
  return { status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="246"><rect width="168" height="246" rx="6" fill="#3b3352"/><rect x="10" y="10" width="148" height="226" rx="4" fill="none" stroke="#c9a24a" stroke-width="2"/><text x="84" y="128" fill="#efe7d5" text-anchor="middle" font-family="Arial" font-size="18">${name}</text></svg>` };
}

/** An engine that only the deep search finds: linked from both Blue-Eyes and Dragunity, so it ranks first once stored. */
function melodious(format: string, held: Set<number>) {
  const links = ["Blue-Eyes", "Dragunity"].map((from) => {
    const row = asFormat([bridge(from, "Melodious", "Good", 66, false, ["Dragon Spirit of White", "Terraforming", "Foolish Burial"], ["Terraforming", "Dragon Spirit of White"],
      ["Terraforming finds the field spell both lines want.", "Dragon Spirit of White works as a Tuner in both."], ["No two-way route found.", "Needs a field spell slot."], "No summon lock.")], format)[0]!;
    return { from, to: "Melodious", bridge: row };
  });
  const cards = [...new Set(links.flatMap((link) => link.bridge.cards))];
  return { engine: "Melodious", score: 13.2, grade: "Good", tier: "strict", covered: 2, of: 2, twoWay: [], links, cards, missing: cards.filter((code) => !held.has(code)),
    genesysPoints: format === "genesys" ? 6 : null, pros: links[0]!.bridge.review.pros, cons: links[0]!.bridge.review.cons };
}
const isBlueDragunity = (set: readonly string[]) => [...set].sort().join("|") === "Blue-Eyes|Dragunity";

/** The stand-in for `POST /api/cards/bridges/engines`: detection from the deck, then the stored rows for the set. */
function enginesAnswer(body: any) {
  const format = body.format ?? "advanced";
  const detected = engineControl.mode === "none"
    ? [{ name: "Dragunity", weight: 2, copies: 2, distinct: 2, status: "light", hybrids: [] }]
    : engineControl.mode === "multi"
    ? [{ name: "Blue-Eyes", weight: 6, copies: 6, distinct: 5, status: "engine", hybrids: [] }, { name: "Dragunity", weight: 4, copies: 4, distinct: 3, status: "engine", hybrids: [] }, { name: "Chaos", weight: 2, copies: 2, distinct: 2, status: "light", hybrids: [] }]
    : [{ name: "Blue-Eyes", weight: 6, copies: 6, distinct: 5, status: "engine", hybrids: [] }, { name: "Dragunity", weight: 2, copies: 2, distinct: 2, status: "light", hybrids: [] }];
  const set: string[] = body.engines ? [...new Set<string>(body.engines.flatMap((name: string) => known(name) ?? []))].sort() : detected.filter((entry) => entry.status === "engine").map((entry) => entry.name).sort();
  const held = new Set<number>(body.deck?.main ?? []);
  const between = set.length > 1 ? asFormat(BRIDGES.filter((entry) => set.includes(entry.source) && set.includes(entry.target)), format) : [];
  const next = set.length === 0 || engineControl.nextEmpty ? [] : ARCHETYPE_NAMES.filter((name) => !set.includes(name)).flatMap((target) => {
    const links = set.flatMap((from) => { const row = BRIDGES.find((entry) => entry.source === from && entry.target === target); return row ? [{ from, to: target, bridge: asFormat([row], format)[0]! }] : []; });
    if (links.length === 0) return [];
    const grade = links.map((link) => link.bridge.grade).sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b))[0]!;
    const cards = [...new Set(links.flatMap((link) => link.bridge.cards))];
    return [{ engine: target, score: links.reduce((sum, link) => sum + link.bridge.score, 0) / 10, grade, tier: grade === "Niche" ? "niche" : "strict", covered: links.length, of: set.length,
      twoWay: links.filter((link) => link.bridge.two_way).map((link) => link.from), links, cards, missing: cards.filter((code) => !held.has(code)), genesysPoints: format === "genesys" ? 6 : null,
      pros: links[0]!.bridge.review.pros, cons: links[0]!.bridge.review.cons }];
  }).concat(bridgeControl.storedExtra && isBlueDragunity(set) && !engineControl.nextEmpty ? [melodious(format, held) as any] : []).sort((a, b) => b.covered - a.covered || b.score - a.score).slice(0, 4);
  return { engines: set, ...(body.deck ? { detected } : {}), between, next, inReview: bridgeControl.reviewCount };
}

async function api(method: string, url: URL, body: any) {
  const path = url.pathname;
  if (path === "/api/decks/1" && method === "GET") {
    const deck = control.deck === "full" ? FULL_DECK : control.deck === "empty" ? { main: [], extra: [], side: [] } : SMALL_DECK;
    return json(200, { deck: { id: 1, name: "Blue-Eyes", mode: control.mode, genesys: control.genesys ? { pointCap: 100 } : null, deck, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" } });
  }
  if (path === "/api/decks/cards/facets") return json(200, FACETS);
  if (path === "/api/decks/cards" && method === "POST") {
    const text = String(body?.text ?? "").toLowerCase();
    const rows = cardDb.prepare<[string], { id: number }>("select d.id from datas d join texts t on t.id = d.id where d.alias = 0 and lower(t.name) like ? order by t.name limit 40").all(`%${text}%`);
    return json(200, { cards: rows.map((row) => details(row.id)).filter(Boolean), total: rows.length, offset: 0 });
  }
  if (path === "/api/duels/cards" && method === "POST") {
    const codes: number[] = body.codes ?? [];
    const cards = codes.map(details).filter(Boolean);
    return json(200, { cards, missing: codes.filter((code) => !details(code)) });
  }
  if (path === "/api/cards/bridges" && method === "GET") {
    bridgeCalls.lists.push(url.search);
    if (bridgeControl.listStatus !== 200) return json(bridgeControl.listStatus, { error: bridgeControl.listStatus === 404 ? "Not found" : "Bridges are busy" });
    const source = known(url.searchParams.get("source") ?? "");
    const format = url.searchParams.get("format") ?? "advanced";
    if (!source) return json(400, { error: "Unknown archetype" });
    const target = url.searchParams.get("target");
    if (target) {
      const other = known(target);
      if (!other) return json(400, { error: "Unknown archetype" });
      const pair = (from: string, to: string) => asFormat(bridgeControl.none ? [] : BRIDGES.filter((entry) => entry.source === from && entry.target === to), format);
      return json(200, { results: pair(source, other), reverse: pair(other, source), inReview: bridgeControl.reviewCount });
    }
    return json(200, { results: asFormat(bridgeControl.none ? [] : BRIDGES.filter((entry) => entry.source === source).sort((a, b) => b.score - a.score), format), inReview: bridgeControl.reviewCount });
  }
  if (path === "/api/cards/bridges/engines" && method === "POST") {
    engineCalls.push(body);
    if (engineControl.delayMs) await new Promise((done) => setTimeout(done, engineControl.delayMs));
    if (engineControl.status !== 200) return json(engineControl.status, { error: engineControl.status === 404 ? "Not found" : "Bridges are busy" });
    return json(200, enginesAnswer(body));
  }
  if (path === "/api/cards/bridges/archetypes" && method === "GET") { bridgeCalls.archetypes += 1; return json(200, { archetypes: ARCHETYPE_NAMES }); }
  if (path === "/api/cards/bridges/deep-search" && method === "POST") {
    bridgeCalls.starts.push(body);
    await new Promise((done) => setTimeout(done, 250));
    if (bridgeControl.startRetryAfter > 0) return json(429, { error: "Deep search hourly limit reached", retryAfter: bridgeControl.startRetryAfter });
    // The host takes one selector (source, deckId or engines); the deck goes with the engines as context only.
    const selectors = ["source", "deckId", "engines"].filter((name) => body[name] !== undefined);
    if (selectors.length !== 1 && !(selectors.length === 0 && body.deck)) return json(400, { error: "Send exactly one of source, deckId or engines." });
    if (body.deck && body.source !== undefined) return json(400, { error: "The deck goes with engines only." });
    const work = deepWork(body);
    const kept = deepJobs.get(work);
    // A join-only request reuses a job the host has, and never starts one.
    if (body.join !== undefined && body.join !== true) return json(400, { error: "join must be true" });
    if (body.join === true && (bridgeControl.joinStatus || !kept)) return json(bridgeControl.joinStatus || 404, { error: bridgeControl.joinStatus === 409 ? "A different deep search is running" : "No deep search to join" });
    // The same search again joins its job; the new deck is this player's context from now on.
    if (kept) {
      if (body.engines || body.deck) multiJobs.set(kept.id, enginesAnswer({ format: body.format, ...(body.engines ? { engines: body.engines } : {}), ...(body.deck ? { deck: body.deck } : {}) }));
      return json(kept.done ? 200 : 202, { jobId: kept.id, state: kept.done ? "done" : "running", cached: kept.done });
    }
    const other = [...deepJobs.entries()].find(([, job]) => !job.done);
    if (other) return json(409, { error: `A deep search for ${JSON.parse(other[0])[1]?.join?.(" + ") ?? "another archetype"} is still running`, retryAfter: 10 });
    bridgeControl.started += 1;
    const jobId = `job-${bridgeControl.started}`;
    deepJobs.set(work, { id: jobId, done: false });
    if (body.engines || body.deck) multiJobs.set(jobId, enginesAnswer({ format: body.format, ...(body.engines ? { engines: body.engines } : {}), ...(body.deck ? { deck: body.deck } : {}) }));
    return json(202, { jobId, state: "queued", cached: false });
  }
  if (path.startsWith("/api/cards/bridges/deep-search/") && method === "GET") {
    bridgeCalls.polls += 1;
    if (bridgeControl.pollBusy > 0) { bridgeControl.pollBusy -= 1; bridgeCalls.polls -= 1; return json(503, { error: "Bridge status is busy", retryAfter: 1 }); }
    if (bridgeControl.pollDelayMs) await new Promise((done) => setTimeout(done, bridgeControl.pollDelayMs));
    const jobId = decodeURIComponent(path.split("/").pop()!);
    const polls = bridgeCalls.polls;
    // Four answers: finding, checking, rating, then done (or failed).
    const phases = [["candidates", 20], ["checking", 55], ["rating", 85]] as const;
    const index = Math.min(polls - 1, 3);
    const entry = [...deepJobs.entries()].find(([, job]) => job.id === jobId);
    if (index < 3 && !entry?.[1].done) return json(200, { jobId, state: index === 0 ? "queued" : "running", step: phases[index]![0], progress: phases[index]![1], results: [], inReview: bridgeControl.reviewCount });
    if (bridgeControl.jobMode === "fail") { if (entry) deepJobs.delete(entry[0]); return json(200, { jobId, state: "failed", step: "rating", progress: 85, results: [], inReview: bridgeControl.reviewCount, error: "The search stopped before it finished. Try again in a minute." }); }
    if (entry) entry[1].done = true;
    const extra = bridge("Blue-Eyes", "Melodious", "Good", 64, false, ["Dragon Spirit of White", "Foolish Burial", "Terraforming"], ["Terraforming", "Dragon Spirit of White"],
      ["Terraforming finds the field spell both lines want.", "Dragon Spirit of White works as a Tuner in both."], ["No two-way route found.", "Needs a field spell slot."], "No summon lock.");
    const multi = multiJobs.get(jobId);
    if (multi && bridgeControl.deepExtra && isBlueDragunity(multi.engines)) {
      bridgeControl.storedExtra = true;
      const next = [melodious("advanced", new Set()), ...multi.next.filter((engine) => engine.engine !== "Dragon Ruler")];
      return json(200, { jobId, state: "done", step: "done", progress: 100, engines: multi.engines, next, results: [], inReview: bridgeControl.reviewCount - 1 });
    }
    if (multi) return json(200, { jobId, state: "done", step: "done", progress: 100, engines: multi.engines, next: bridgeControl.deepNone ? [] : multi.next.slice(0, 6), results: [], inReview: bridgeControl.reviewCount - 1 });
    const strict = BRIDGES.filter(entry => entry.source === "Blue-Eyes").slice(0, 4);
    const niche = ["Melodious", "Magistus", "Fire Fist", "Buster Blader", "Primite", "Dracotail", "Beyond cap"].map(target => ({
      ...extra, target, tier: "niche", grade: "Niche", evidence_hash: hashOf(`Blue-Eyes>${target}`), review: { ...extra.review, grade: "niche" },
    }));
    return json(200, { jobId, state: "done", step: "done", progress: 100, results: [...strict, ...niche], inReview: bridgeControl.reviewCount - 1 });
  }
  if (path === "/api/cards/bridges/feedback" && method === "POST") {
    bridgeCalls.feedback.push(body);
    if (bridgeControl.feedbackFails) return json(503, { error: "Reports are not available right now." });
    return json(200, { accepted: true, hidden: false });
  }
  if (path === "/api/cards/insights" && method === "POST") {
    if (body.op === "suggestRows") {
      insightRequests.push({ deck: body.deck, pool: body.pool, at: Date.now() });
      if (control.delayMs) await new Promise((done) => setTimeout(done, control.delayMs));
      const rows = ROW_FIXTURE(body.deck.main.length);
      return json(200, { rows: control.emptyRows ? rows.map(row => ({ ...row, cards: [] })) : rows, version: 1 });
    }
    return json(200, { effectSearchEnabled: true, summary: null });
  }
  return json(404, { error: `harness: no route ${method} ${path}` });
}

// ---- Bundle the real editor for the browser -----------------------------------------------------------
const bundle = resolve(out, "bundle");
await build({
  configFile: false, envDir: false, root: e2e, logLevel: "warn", cacheDir: resolve(out, ".vite"), base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  css: { postcss: { plugins: [tailwindcss({ base: web })] } },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(web, "src")}/` },
      { find: /^next\/navigation$/, replacement: resolve(e2e, "deck-suggestions-next.ts") },
    ],
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: bundle, emptyOutDir: true, rollupOptions: { input: resolve(e2e, "deck-suggestions-browser.tsx"), output: { entryFileNames: "browser.js", assetFileNames: "browser.[ext]" } } },
  plugins: [{
    name: "suggestions-next-stubs", enforce: "pre",
    resolveId(source: string) {
      if (source === "next/font/google" || source === "next/font/local") return "\0fonts";
      if (source === "next/link") return "\0link";
      if (source === "next/image") return "\0image";
    },
    load(source: string) {
      if (source === "\0fonts") return `const font = () => ({ className: "", variable: "", style: {} }); export { font as Oxanium, font as Newsreader, font as Sofia_Sans_Semi_Condensed, font as Sofia_Sans_Extra_Condensed, font as Barlow_Condensed, font as Barlow_Semi_Condensed }; export default font;`;
      if (source === "\0link") return `import { createElement } from "react"; export default function Link({ href, prefetch, ...rest }) { return createElement("a", { href: String(href), ...rest }); }`;
      if (source === "\0image") return `import { createElement } from "react"; export default function Image({ src, alt, fill, priority, unoptimized, ...rest }) { return createElement("img", { src: String(src), alt, ...rest }); }`;
    },
  }, react()],
});
await writeFile(resolve(bundle, "index.html"), `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Deck suggestions proof</title><link rel="stylesheet" href="./browser.css">
  <style>body{margin:0;min-height:100vh;background:#0A0E1A;color:#E8ECF4;font-family:Arial,sans-serif} .harness-rail{width:0}@media (min-width:820px){.harness-rail{width:236px;flex:none;background:#0d0f15;border-right:1px solid #232634}}</style></head>
  <body><div id="root"></div><script type="module" src="./browser.js"></script></body></html>`);

// ---- The scripted scenario ------------------------------------------------------------------------
type Check = { step: string; check: string; ok: boolean; detail: string };
const checks: Check[] = [];
const shots: Record<string, string> = {};
function check(step: string, name: string, ok: boolean, detail: unknown = "") {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  checks.push({ step, check: name, ok, detail: text });
  console.log(`${ok ? "PASS" : "FAIL"} [${step}] ${name}${text === "" ? "" : ` (${text})`}`);
}

const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 }, { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1366x768", width: 1366, height: 768 }, { name: "390x844", width: 390, height: 844 },
];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pageErrors: string[] = [];
const unrouted: string[] = [];
let exitCode = 0;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  await page.route(`${ORIGIN}/**`, async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    const image = /^\/api\/cards\/(\d+)\/image$/.exec(url.pathname);
    if (image) return route.fulfill(cardImage(image[1]!));
    if (url.pathname.startsWith("/api/")) {
      const raw = request.postData();
      const response = await api(request.method(), url, raw ? JSON.parse(raw) : null);
      if (response.status === 404 && !(url.pathname === "/api/cards/bridges" && bridgeControl.listStatus === 404) && !(url.pathname === "/api/cards/bridges/engines" && engineControl.status === 404) && !(url.pathname === "/api/cards/bridges/deep-search" && request.method() === "POST")) unrouted.push(`${request.method()} ${url.pathname}`);
      return route.fulfill(response);
    }
    const publicDir = resolve(web, "public");
    let file = resolve(bundle, `.${url.pathname}`);
    if (!file.startsWith(bundle) || !existsSync(file)) file = resolve(publicDir, `.${url.pathname}`);
    if ((!file.startsWith(publicDir) && !file.startsWith(bundle)) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
    return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });

  const panel = page.getByTestId("deck-suggestions");
  const search = () => page.getByRole("searchbox").or(page.locator('input[type="search"]')).first();
  const shot = async (name: string) => {
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file });
    shots[name] = file;
  };
  // The right column has tabs (Cards, Suggest, Bridges); a phone has Deck first. With the flag off there are none.
  const goTab = async (name: "Cards" | "Suggest" | "Bridges") => {
    // A tab with a dot also says "(new results)".
    const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
    if (await tab.isVisible().catch(() => false)) await tab.click();
  };
  const open = async (deck: "small" | "full" | "empty", flag = "on", tab: "Cards" | "Suggest" | "Bridges" = "Suggest") => {
    control.deck = deck;
    insightRequests.length = 0;
    bridgeCalls.lists.length = 0;
    engineCalls.length = 0;
    // A search left running by an earlier scenario would answer the next start with a 409 it did not ask for.
    for (const [work, job] of deepJobs) if (!job.done) deepJobs.delete(work);
    await page.goto(`${ORIGIN}/index.html?deck=1&flag=${flag}`);
    // Some scenarios show no tabs at all, so a missing tab is not an error.
    await page.getByRole("tab", { name: "Cards", exact: true }).waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
    await goTab(tab);
  };
  // Positions are relative to the panel, so a scroll of the list (hover scrolls a tile into view) is not a move.
  const tileBoxes = () => panel.evaluate((root: HTMLElement) => { const base = root.getBoundingClientRect(); return [...root.querySelectorAll('section[aria-labelledby^="suggest-"]:not([aria-labelledby="suggest-engines"]) button')].map((node) => { const box = node.getBoundingClientRect(); return [Math.round(box.x - base.x), Math.round(box.y - base.y), Math.round(box.width), Math.round(box.height)]; }); });
  const rowTitles = () => panel.locator("h3:not(#suggest-engines)").allTextContents();
  // The four card rows; the "Engines that fit" row above them has its own tests.
  const tileButtons = panel.locator('section[aria-labelledby^="suggest-"]:not([aria-labelledby="suggest-engines"]) button');

  if (process.env.SUGGESTIONS_BRIDGES_ONLY !== "1") {
  await page.goto(`${ORIGIN}/index.html?scenario=pool`);
  await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
  check("pool", "initial pool asks once", insightRequests.length === 1);
  await page.getByRole("button", { name: "Reorder pool", exact: true }).click();
  await page.waitForTimeout(900);
  check("pool", "pool order does not change the query", insightRequests.length === 1);
  await page.getByRole("button", { name: "Replace pool card", exact: true }).click();
  await page.waitForTimeout(1500);
  check("pool", "same-size pool replacement sends a new query", insightRequests.length === 2, insightRequests.map(request => request.pool));
  check("pool", "replacement query contains the changed pool", insightRequests.at(-1)?.pool?.includes(23995346) === true);

  // The Suggest tab keeps (within a card row of drift, since cards size to their text) its height on the initial response and when rows empty.
  const listTop = () => panel.evaluate((root: HTMLElement) => {
    const parent = root.parentElement!;
    return root.getBoundingClientRect().bottom - parent.getBoundingClientRect().top + parent.scrollTop;
  });
  for (const viewport of VIEWPORTS.filter(viewport => [1366, 1920].includes(viewport.width))) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    control.delayMs = 1800;
    await open("small");
    await panel.locator('section[aria-labelledby="suggest-archetype"]').waitFor();
    const before = await listTop();
    await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
    const after = await listTop();
    check("layout", `${viewport.name}: list top is stable on first answer`, Math.abs(after - before) <= 40, { before, after });
    check("layout", `${viewport.name}: all four slots are present`, await panel.locator('section[aria-labelledby^="suggest-"]:not([aria-labelledby="suggest-engines"])').count() === 4);
    control.emptyRows = true; control.delayMs = 0;
    await panel.locator('section[aria-labelledby="suggest-archetype"] button').first().dblclick();
    await panel.getByText("No archetype support fits your deck yet.").waitFor({ timeout: 10_000 });
    const emptyTop = await listTop();
    check("layout", `${viewport.name}: list top is stable when all rows empty`, Math.abs(emptyTop - after) <= 1, { after, emptyTop });
    check("layout", `${viewport.name}: empty rows retain four slots`, await panel.locator('section[aria-labelledby^="suggest-"]:not([aria-labelledby="suggest-engines"])').count() === 4);
    await shot(`stable-empty-${viewport.name}`);
    control.emptyRows = false;

    // The Engines that fit row keeps one height: a slow engine answer, then an empty one, moves no card row.
    engineControl.delayMs = 2500;
    await open("small");
    await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
    const waitingBoxes = await tileBoxes();
    const loadingEngines = await page.getByTestId("engines-fit").getByRole("status").count();
    await page.getByTestId("engine-fit-item").first().waitFor({ state: "visible", timeout: 15_000 });
    const answeredBoxes = await tileBoxes();
    const moved = (a: number[][], b: number[][]) => a.map((box, i) => b[i] && box.every((value, axis) => Math.abs(value - b[i]![axis]!) <= 1) ? null : [i, box, b[i]]).filter(Boolean);
    check("layout", `${viewport.name}: the engine answer moves no card row`, loadingEngines === 1 && answeredBoxes.length === waitingBoxes.length && moved(waitingBoxes, answeredBoxes).length === 0, { loadingEngines, moved: moved(waitingBoxes, answeredBoxes).slice(0, 3) });
    engineControl.delayMs = 0; engineControl.nextEmpty = true;
    await panel.locator('section[aria-labelledby="suggest-staples"] button').first().dblclick();
    await page.getByTestId("engines-fit-empty").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const emptyBoxes = await tileBoxes();
    check("layout", `${viewport.name}: an empty engine answer after a deck edit moves no card row`, moved(answeredBoxes, emptyBoxes).length === 0, moved(answeredBoxes, emptyBoxes).slice(0, 3));
    engineControl.nextEmpty = false;
  }
  control.delayMs = 0;
  // The Engines that fit row keeps its height at the other sizes too.
  for (const viewport of VIEWPORTS.filter(viewport => [390, 2560].includes(viewport.width))) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    engineControl.delayMs = 2500;
    await open("small");
    await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
    const waitingBoxes = await tileBoxes();
    const loadingEngines = await page.getByTestId("engines-fit").getByRole("status").count();
    await page.getByTestId("engine-fit-item").first().waitFor({ state: "visible", timeout: 15_000 });
    const answeredBoxes = await tileBoxes();
    const moved = (a: number[][], b: number[][]) => a.map((box, i) => b[i] && box.every((value, axis) => Math.abs(value - b[i]![axis]!) <= 1) ? null : [i, box, b[i]]).filter(Boolean);
    check("layout", `${viewport.name}: the engine answer moves no card row`, loadingEngines === 1 && answeredBoxes.length === waitingBoxes.length && moved(waitingBoxes, answeredBoxes).length === 0, { loadingEngines, moved: moved(waitingBoxes, answeredBoxes).slice(0, 3) });
    engineControl.delayMs = 0; engineControl.nextEmpty = true;
    await panel.locator('section[aria-labelledby="suggest-staples"] button').first().dblclick();
    await page.getByTestId("engines-fit-empty").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const emptyBoxes = await tileBoxes();
    check("layout", `${viewport.name}: an empty engine answer after a deck edit moves no card row`, moved(answeredBoxes, emptyBoxes).length === 0, moved(answeredBoxes, emptyBoxes).slice(0, 3));
    engineControl.nextEmpty = false;
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // a. A small deck: three ready rows, the Extra row as a hint.
  await open("small");
  await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(500);
  check("a", "Suggestions show while the search box is empty", await panel.isVisible());
  check("a", "rows are in the owner's order", JSON.stringify(await rowTitles()) === JSON.stringify(["Archetype support", "Outside the archetype", "Extra Deck you can make", "Staples for this format"]), await rowTitles());
  check("a", "the Extra row shows its hint under 40 Main cards", (await panel.getByText("Add 40 Main Deck cards to see what your deck can make").count()) === 1);
  check("a", "Staples show at most 6 cards", (await panel.locator('section[aria-labelledby="suggest-staples"] button').count()) <= 6);
  const text = (await page.locator("body").innerText()).toLowerCase();
  check("a", "no AI or searchygo text on the page", !/\bai\b|searchygo/.test(text));
  check("a", "the first answer took one request", insightRequests.length === 1, insightRequests.length);
  check("a", "Bridges wait for their tab: no request while it is closed", bridgeCalls.lists.length === 0, bridgeCalls.lists);
  await goTab("Bridges");
  await page.getByTestId("bridges-row").getByTestId("bridge-item").first().waitFor({ timeout: 15_000 });
  await goTab("Suggest");
  check("a", "Bridges ask for the deck archetype in the deck's format", bridgeCalls.lists.length === 1 && bridgeCalls.lists[0] === "?source=Blue-Eyes&format=advanced", bridgeCalls.lists);
  const whyHeights = await panel.locator("button span[class*=why]").evaluateAll((nodes: HTMLElement[]) => [...new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().height)))]);
  check("a", "every reason has the same fixed height", whyHeights.length === 1, whyHeights);
  // A very long reason is clamped to the same box and does not grow the tile.
  const clamp = await panel.locator("button span[class*=why]").first().evaluate((node: HTMLElement) => {
    const card = node.closest("button") as HTMLElement; const before = [card.getBoundingClientRect().height, node.getBoundingClientRect().height];
    const text = node.textContent; node.textContent = "A very long reason that goes on and on about what this card does for the deck. ".repeat(8);
    const after = [card.getBoundingClientRect().height, node.getBoundingClientRect().height, node.scrollHeight - node.clientHeight];
    node.textContent = text; return { before, after };
  });
  check("a", "a long reason is clamped, not grown", clamp.after[2] > 0 && clamp.before[0] === clamp.after[0] && clamp.before[1] === clamp.after[1], clamp);
  const badges = await panel.locator("span[class*=de-lim]").count();
  const badgeOverlap = await tileButtons.evaluateAll((nodes: HTMLElement[]) => nodes.filter((node) => {
    const badge = node.querySelector("[class*=de-lim]") as HTMLElement | null;
    const have = node.querySelector("[class*=have]") as HTMLElement | null;
    const name = node.querySelector("[class*=name]") as HTMLElement | null;
    if (!badge) return false;
    const a = badge.getBoundingClientRect();
    return [have, name].some((other) => { if (!other) return false; const b = other.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; });
  }).length);
  check("a", "ban marks show and do not cover the name or count", badges > 0 && badgeOverlap === 0, { badges, badgeOverlap });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(250);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await shot(`small-${viewport.name}`);
    check("a", `no sideways page scroll at ${viewport.name}`, noScroll);
    // Whole cards only: every card sits inside the panel, and no list scrolls sideways.
    const clipped = await panel.evaluate((root: HTMLElement) => {
      const box = root.getBoundingClientRect();
      const cards = [...root.querySelectorAll("li > button")] as HTMLElement[];
      const outside = cards.filter((node) => { const r = node.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).length;
      const scrolling = [...root.querySelectorAll("ul")].filter((list) => list.scrollWidth > list.clientWidth + 1).length;
      const textCut = cards.filter((node) => { const name = node.querySelector("[class*=name]") as HTMLElement | null; const r = node.getBoundingClientRect(); return name ? name.getBoundingClientRect().right > r.right + 0.5 : false; }).length;
      return { outside, scrolling, textCut, cards: cards.length };
    });
    check("a", `every card is whole inside the panel at ${viewport.name}`, clipped.outside === 0 && clipped.scrolling === 0 && clipped.textCut === 0 && clipped.cards > 0, clipped);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // a2. A row shows 4 cards; "Show more (N)" opens the rest and "Show less" closes them.
  const stapleCount = () => panel.locator('section[aria-labelledby="suggest-staples"] li > button').count();
  check("a2", "a long row shows 4 cards by default", (await stapleCount()) === 4, await stapleCount());
  const more = panel.locator('section[aria-labelledby="suggest-staples"] button[aria-expanded]');
  check("a2", "the row offers Show more with the hidden count", (await more.innerText()).trim() === "Show more (2)", await more.innerText());
  check("a2", "a row of 4 or less has no Show more", (await panel.locator('section[aria-labelledby="suggest-archetype"] button[aria-expanded]').count()) === 0);
  await more.click();
  check("a2", "Show more opens the rest of the row", (await stapleCount()) === 6, await stapleCount());
  await shot("show-more-open");
  check("a2", "the opened row stays whole inside the panel", await panel.evaluate((root: HTMLElement) => { const box = root.getBoundingClientRect(); return [...root.querySelectorAll("li > button")].every((node) => { const r = node.getBoundingClientRect(); return r.left >= box.left - 0.5 && r.right <= box.right + 0.5; }); }));
  await more.click();
  check("a2", "Show less closes the row again", (await stapleCount()) === 4, await stapleCount());

  // b. Hover moves nothing.
  await page.waitForTimeout(800);
  const before = await tileBoxes();
  await tileButtons.nth(0).hover();
  await tileButtons.nth(1).hover();
  await page.waitForTimeout(250);
  const afterHover = await tileBoxes();
  check("b", "hover leaves every tile where it was", JSON.stringify(before) === JSON.stringify(afterHover), before.map((box: number[], i: number) => JSON.stringify(box) === JSON.stringify(afterHover[i]) ? null : [i, box, afterHover[i]]).filter(Boolean).slice(0, 3));

  // c. A tile inspects on click, adds on double-click and right-click, and drags into the deck.
  const mainCount = async () => Number(/Main\s+(\d+)/.exec(await page.locator('main[aria-label="Deck"]').innerText())?.[1] ?? -1);
  const tile = panel.locator('section[aria-labelledby="suggest-outside"] button').first();
  await tile.click();
  await page.waitForTimeout(300);
  check("c", "click inspects the card (pressed)", (await tile.getAttribute("aria-pressed")) === "true");
  check("c", "the card view names the card", (await page.locator('aside[aria-label="Card details"]').innerText()).includes("Burst Stream of Destruction"));
  await shot("c-inspect");
  const start = await mainCount();
  await panel.locator('section[aria-labelledby="suggest-outside"] button').nth(1).dblclick();
  await page.waitForTimeout(200);
  check("c", "double-click adds the card to the Main Deck", (await mainCount()) === start + 1, { start, now: await mainCount() });
  await panel.locator('section[aria-labelledby="suggest-outside"] button').nth(0).click({ button: "right" });
  await page.waitForTimeout(200);
  check("c", "right-click adds the card to the Main Deck", (await mainCount()) === start + 2, { start, now: await mainCount() });
  await panel.locator('section[aria-labelledby="suggest-outside"] button').nth(0).dragTo(page.locator('main[aria-label="Deck"] section').first());
  await page.waitForTimeout(200);
  check("c", "dragging a tile into the deck adds the card", (await mainCount()) === start + 3, { start, now: await mainCount() });

  // c2. Three quick changes make one request, after the 600 ms wait.
  await page.waitForTimeout(1500);
  const settled = insightRequests.length;
  for (const index of [0, 1, 2]) await panel.locator('section[aria-labelledby="suggest-staples"] button').nth(index).dblclick();
  await page.waitForTimeout(300);
  check("c2", "no request while the changes are still fresh", insightRequests.length === settled, insightRequests.length - settled);
  await page.waitForTimeout(1500);
  check("c2", "three quick changes ask once", insightRequests.length === settled + 1, insightRequests.length - settled);
  check("c2", "the deck in that request has all the changes", insightRequests.at(-1)?.deck.main.length === (await mainCount()), insightRequests.at(-1)?.deck.main.length);

  // c3. A slow answer: the old rows stay and nothing moves.
  control.delayMs = 2500;
  const shown = await tileBoxes();
  await panel.locator('section[aria-labelledby="suggest-staples"] button').nth(3).dblclick();
  await page.waitForTimeout(1300);
  check("c3", "the status says Updating while the answer is slow", (await panel.getByText("Updating…").count()) === 1);
  check("c3", "the old rows stay on screen while loading", (await tileBoxes()).length === shown.length && (await tileButtons.count()) > 0);
  // Boxes are rounded, so a half-pixel of layout can show as one pixel; two or more is a real move.
  { const moved = await tileBoxes(); const off = shown.map((box: number[], i: number) => moved[i] && box.every((value, axis) => Math.abs(value - moved[i][axis]) <= 1) ? null : [i, box, moved[i]]).filter(Boolean); check("c3", "no tile moved while loading", off.length === 0, off.slice(0, 3)); }
  await shot("c3-updating");
  await page.waitForTimeout(2500);
  check("c3", "the status clears when the answer lands", (await panel.getByText("Updating…").count()) === 0);
  control.delayMs = 0;

  // d. A search on the Cards tab stays there: Suggest keeps its rows and asks for nothing new.
  const requestsBefore = insightRequests.length;
  await goTab("Cards");
  await search().fill("dragon");
  await page.waitForTimeout(400);
  await shot("d-search");
  await goTab("Suggest");
  check("d", "a search on the Cards tab does not hide Suggest", await panel.isVisible() && (await tileButtons.count()) > 0);
  await goTab("Cards");
  check("d", "the search text stays when the tab is closed and opened again", (await search().inputValue()) === "dragon");
  await search().fill("");
  await goTab("Suggest");
  await page.waitForTimeout(900);
  check("d", "the same deck is not asked for again", insightRequests.length === requestsBefore, insightRequests.length - requestsBefore);

  // e. Flag off: no panel.
  await open("small", "off");
  await page.waitForTimeout(1500);
  check("e", "Suggestions are off when the server flag is off", (await panel.count()) === 0 && insightRequests.length === 0, insightRequests.length);
  check("e", "no bridge request while Suggestions are off", bridgeCalls.lists.length === 0, bridgeCalls.lists);

  // f. A deck with 40 Main cards gets the Extra row as cards.
  await open("full");
  await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
  check("f", "the Extra row shows cards at 40 Main cards", (await panel.locator('section[aria-labelledby="suggest-extra"] button').count()) === 4 && (await panel.getByText("Add 40 Main Deck cards").count()) === 0);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(250);
    await shot(`full-${viewport.name}`);
  }
  // The phone layout keeps the card list on its own tab.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Suggest", exact: true }).click();
  await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400);
  await shot("full-390x844-cards-tab");
  check("f", "the phone Cards tab shows Suggestions without sideways page scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 1920, height: 1080 });

  // g. An empty deck: a short empty state, and no request.
  await open("empty");
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1200);
  check("g", "an empty deck shows the empty state", (await panel.innerText()).includes("Add a few Main Deck cards"));
  check("g", "an empty deck makes no request", insightRequests.length === 0 && bridgeCalls.lists.length === 0, { insight: insightRequests.length, bridges: bridgeCalls.lists });
  await shot("g-empty-deck");
  await goTab("Bridges");
  await page.getByTestId("bridges-empty").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1000);
  check("g", "an empty deck gets a short Bridges hint", (await page.getByTestId("bridges-empty").innerText()).includes("Add a few Main Deck cards"));
  check("g", "the Bridges tab of an empty deck asks for nothing", bridgeCalls.lists.length === 0 && engineCalls.length === 0, { lists: bridgeCalls.lists, engines: engineCalls.length });

  }

  // h. Bridges: the row, its details, the two-archetype search, the deep search and the report action.
  const bridges = page.getByTestId("bridges-row");
  const items = bridges.getByTestId("bridge-item");
  const reset = async (deck: "small" | "full" | "empty" = "small") => {
    await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* Storage is not available. */ } });
    bridgeCalls.starts.length = 0; bridgeCalls.feedback.length = 0; bridgeCalls.polls = 0; bridgeCalls.archetypes = 0; deepJobs.clear();
    Object.assign(bridgeControl, { listStatus: 200, none: false, pollDelayMs: 0, startRetryAfter: 0, jobMode: "ok", feedbackFails: false, deepNone: false });
    await open(deck, "on", "Bridges");
    await items.first().waitFor({ state: "visible", timeout: 15_000 });
  };
  /** Whole items, no sideways scroll, nothing cut at the panel edge. */
  const whole = (name: string) => bridges.evaluate((root: HTMLElement, label: string) => {
    const box = root.getBoundingClientRect();
    const nodes = [...root.querySelectorAll('[data-testid="bridges-row"] li')] as HTMLElement[];
    const outside = nodes.filter((node) => { const r = node.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).length;
    const clipped = [...root.querySelectorAll('[data-testid="bridge-item"]')].filter((node) => node.scrollWidth > node.clientWidth + 1).length;
    return { label, outside, clipped, page: document.documentElement.scrollWidth <= window.innerWidth + 1, items: nodes.length };
  }, name);
  const settle = async () => { await bridges.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); };

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await reset();
    await settle();
    const layout = await whole(viewport.name);
    check("h", `${viewport.name}: bridge items are whole and the page does not scroll sideways`, layout.outside === 0 && layout.clipped === 0 && layout.page && layout.items > 0, layout);
    await shot(`bridges-list-${viewport.name}`);

    // Details: open the first bridge, then go back.
    await items.first().locator("button[data-bridge]").click();
    await bridges.getByTestId("bridge-details").waitFor();
    await settle();
    await shot(`bridges-details-${viewport.name}`);
    const detailsLayout = await whole(`${viewport.name} details`);
    check("h", `${viewport.name}: bridge details fit the panel`, detailsLayout.outside === 0 && detailsLayout.page, detailsLayout);
    await bridges.getByRole("button", { name: /^Back/ }).click();
    await items.first().waitFor();

    // The two-archetype search.
    await bridges.getByTestId("bridge-search-toggle").click();
    const search = bridges.getByTestId("bridge-search");
    await search.getByRole("combobox").nth(1).fill("Dragu");
    await search.getByRole("option", { name: "Dragunity" }).click();
    await search.getByTestId("bridge-search-results").waitFor();
    await settle();
    await shot(`bridges-search-${viewport.name}`);
    const searchLayout = await whole(`${viewport.name} search`);
    check("h", `${viewport.name}: the two-archetype search fits the panel`, searchLayout.outside === 0 && searchLayout.page, searchLayout);

    // A deep search that is running, and its result.
    await reset();
    await bridges.getByTestId("deep-search-button").click();
    await bridges.getByTestId("deep-progress").waitFor();
    await bridges.getByTestId("deep-progress").locator('li[data-state="current"]', { hasText: "Checking cards" }).waitFor({ timeout: 10_000 });
    await settle();
    await shot(`bridges-deep-running-${viewport.name}`);
    await bridges.getByTestId("deep-results").waitFor({ timeout: 15_000 });
    await settle();
    await shot(`bridges-deep-done-${viewport.name}`);
    const deepLayout = await whole(`${viewport.name} deep`);
    check("h", `${viewport.name}: deep search results fit the panel`, deepLayout.outside === 0 && deepLayout.page, deepLayout);

    // A report: the form and the thank-you.
    await reset();
    await items.nth(1).getByTestId("bridge-report").click();
    await items.nth(1).getByRole("textbox").fill("The line needs a card the deck does not play.");
    await settle();
    await shot(`bridges-report-${viewport.name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // h1. The row: the top four bridges, best first, with everything the owner asked for on each.
  await reset();
  const titles = await bridges.locator("h3").allTextContents();
  check("h1", "the row is called Bridges and leads with the owner's words", titles[0] === "Bridges" && (await bridges.innerText()).includes("can bridge into"), titles);
  check("h1", "five bridges come back and four show", (await items.count()) === 4, await items.count());
  check("h1", "bridges show best first", JSON.stringify(await items.locator("strong").allInnerTexts()) === JSON.stringify(["Dragunity", "Dragon Ruler", "Chaos", "Red-Eyes"]), await items.locator("strong").allInnerTexts());
  check("h1", "each bridge has a grade badge", JSON.stringify(await items.getByTestId("bridge-grade").allInnerTexts()) === JSON.stringify(["Strong", "Good", "Niche", "Risky"]));
  check("h1", "each bridge says one-way or two-way in words", JSON.stringify(await items.locator("span[data-way]").allInnerTexts()) === JSON.stringify(["Two-way", "One-way", "One-way", "Two-way"]), await items.locator("span[data-way]").allInnerTexts());
  check("h1", "each bridge has a quiet Report action, not a verdict", JSON.stringify(await items.getByTestId("bridge-report").allInnerTexts()) === JSON.stringify(["Report", "Report", "Report", "Report"]) && (await items.first().getByTestId("bridge-report").getAttribute("aria-label")) === "Report a wrong bridge" && (await items.first().getByTestId("bridge-report").getAttribute("title")) === "Report a wrong bridge" && (await bridges.innerText()).includes("doesn't work") === false);
  check("h1", "Report is the last thing in the grade row and smaller than the grade badge", await items.first().evaluate((node: HTMLElement) => { const report = node.querySelector('[data-testid="bridge-report"]')!.getBoundingClientRect(); const grade = node.querySelector('[data-testid="bridge-grade"]')!.getBoundingClientRect(); return report.left > grade.right && parseFloat(getComputedStyle(node.querySelector('[data-testid="bridge-report"]')!).fontSize) <= parseFloat(getComputedStyle(node.querySelector('[data-testid="bridge-grade"]')!).fontSize); }));
  await shot("report-1920x1080");
  const thumbCounts = await items.evaluateAll((nodes: HTMLElement[]) => nodes.map((node) => node.querySelectorAll('ul[aria-label="Bridge cards"] button').length));
  check("h1", "each bridge shows 2 to 4 card images", thumbCounts.every((count: number) => count >= 2 && count <= 4), thumbCounts);
  const points = await items.evaluateAll((nodes: HTMLElement[]) => nodes.map((node) => [node.querySelectorAll('ul[aria-label="Good"] li').length, node.querySelectorAll('ul[aria-label="Bad"] li').length]));
  check("h1", "each bridge shows 2 good and 2 bad points", points.every(([good, bad]: number[]) => good === 2 && bad === 2), points);
  check("h1", "a lock or format warning shows on the bridges that have one", (await items.nth(2).getByRole("list", { name: "Warnings" }).innerText()).includes("Forbidden") && (await items.nth(0).getByRole("list", { name: "Warnings" }).count()) === 0);
  check("h1", "the list text says nothing about AI", !/\bai\b|\bllm\b|judge/i.test(await bridges.innerText()));
  // A card image opens the card inspector, like a tile elsewhere in Suggestions.
  const thumb = items.first().locator('ul[aria-label="Bridge cards"] button').first();
  const thumbName = (await thumb.getAttribute("aria-label")) ?? "";
  await thumb.hover();
  await page.waitForTimeout(300);
  check("h1", "hovering a bridge card opens the card inspector", (await page.locator('aside[aria-label="Card details"]').innerText()).includes(thumbName), thumbName);
  await thumb.click();
  await page.waitForTimeout(300);
  check("h1", "clicking a bridge card pins it in the inspector", (await thumb.getAttribute("aria-pressed")) === "true" && (await page.locator('aside[aria-label="Card details"]').innerText()).includes(thumbName));
  // The bridge cards load in one batch, not one call each.
  check("h1", "the row asked once for bridges", bridgeCalls.lists.length === 1, bridgeCalls.lists);

  // h2. Details: the line, the cards, a breadcrumb and Back.
  await items.first().locator("button[data-bridge]").click();
  const details = bridges.getByTestId("bridge-details");
  await details.waitFor();
  check("h2", "the breadcrumb names the source and the target", (await details.getByRole("navigation", { name: "Where you are" }).innerText()).replace(/\s+/g, " ").includes("Blue-Eyes") && (await details.getByRole("navigation", { name: "Where you are" }).innerText()).includes("Dragunity"));
  check("h2", "Back has the focus when the details open", await page.evaluate(() => /^Back/.test(document.activeElement?.textContent ?? "")));
  check("h2", "the line lists the card names in order", JSON.stringify(await details.getByTestId("bridge-line").locator("li").allInnerTexts()) === JSON.stringify(["Sage with Eyes of Blue", "Dragon Shrine", "Dragunity Phalanx"]), await details.getByTestId("bridge-line").locator("li").allInnerTexts());
  check("h2", "every bridge card is a drill-down tile", (await details.getByTestId("bridge-cards").locator("li > button").count()) === 4);
  check("h2", "the details show the lock note", (await details.innerText()).includes("No summon lock"));
  const tileButton = details.getByTestId("bridge-cards").locator("li > button").first();
  await tileButton.click();
  await page.waitForTimeout(300);
  check("h2", "a bridge card tile opens the inspector", (await tileButton.getAttribute("aria-pressed")) === "true");
  await bridges.getByRole("button", { name: /^Back/ }).click();
  await items.first().waitFor();
  check("h2", "Back returns to the list", (await details.count()) === 0 && (await items.count()) === 4);
  check("h2", "Back gives the focus to the bridge it came from", await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute("data-bridge")));

  // h3. The report action: optional reason, thank-you, once per bridge, a clear error.
  const report = items.nth(1);
  await report.getByTestId("bridge-report").click();
  await report.getByRole("textbox").fill("The line needs a card the deck does not play.");
  bridgeControl.feedbackFails = true;
  await report.getByRole("button", { name: "Send" }).click();
  await report.getByRole("alert").waitFor();
  check("h3", "a failed report shows a clear error and keeps the form", (await report.getByRole("alert").innerText()).includes("not available") && (await report.getByTestId("bridge-report-form").count()) === 1);
  bridgeControl.feedbackFails = false;
  await report.getByRole("button", { name: "Send" }).dblclick();
  await report.getByTestId("bridge-thanks").waitFor();
  check("h3", "a double click on Send sends one report", bridgeCalls.feedback.filter((entry) => entry.reason).length === 2 && bridgeCalls.feedback.length === 2, bridgeCalls.feedback);
  check("h3", "the report carries the bridge hash and the reason", bridgeCalls.feedback.at(-1)?.evidenceHash === hashOf("Blue-Eyes>Dragon Ruler") && bridgeCalls.feedback.at(-1)?.reason === "The line needs a card the deck does not play.", bridgeCalls.feedback.at(-1));
  check("h3", "a thank-you replaces the form and the action", (await report.getByTestId("bridge-report").count()) === 0 && (await report.getByTestId("bridge-thanks").innerText()).includes("Thank you"));
  await open("small", "on", "Bridges");
  await items.first().waitFor();
  check("h3", "the same bridge cannot be reported twice in this browser", (await items.nth(1).getByTestId("bridge-thanks").count()) === 1 && (await items.nth(1).getByTestId("bridge-report").count()) === 0);
  await items.nth(0).getByTestId("bridge-report").click();
  await items.nth(0).getByRole("button", { name: "Send" }).click();
  await items.nth(0).getByTestId("bridge-thanks").waitFor();
  check("h3", "the reason is optional", bridgeCalls.feedback.at(-1)?.reason === undefined, bridgeCalls.feedback.at(-1));

  // h4. The free "X to Y" search: names by autocomplete, the bridge each way.
  await reset();
  await bridges.getByTestId("bridge-search-toggle").click();
  const pair = bridges.getByTestId("bridge-search");
  const [from, to] = [pair.getByRole("combobox").nth(0), pair.getByRole("combobox").nth(1)];
  check("h4", "the first box starts with the deck archetype", (await from.inputValue()) === "Blue-Eyes", await from.inputValue());
  await to.fill("dragu");
  check("h4", "typing offers the matching archetype names", JSON.stringify(await pair.getByRole("option").allInnerTexts()) === JSON.stringify(["Dragunity"]), await pair.getByRole("option").allInnerTexts());
  await to.press("ArrowDown");
  await to.press("Enter");
  await pair.getByTestId("bridge-search-results").waitFor();
  check("h4", "the search shows the bridge each way", (await pair.getByTestId("bridge-item").count()) === 2 && (await pair.getByRole("heading", { level: 4 }).allInnerTexts()).join("|") === "Blue-Eyes → Dragunity|Dragunity → Blue-Eyes", await pair.getByRole("heading", { level: 4 }).allInnerTexts());
  check("h4", "the search asks for both names in the deck's format", bridgeCalls.lists.at(-1) === "?source=Blue-Eyes&format=advanced&target=Dragunity", bridgeCalls.lists.at(-1));
  check("h4", "the archetype list loads once", bridgeCalls.archetypes === 1, bridgeCalls.archetypes);
  await from.fill("Chaos");
  await to.fill("Red-Eyes");
  await page.waitForTimeout(400);
  check("h4", "a pair with no bridge says so, both ways", (await pair.getByTestId("bridge-search-none").count()) === 2, await pair.getByTestId("bridge-search-none").count());
  await to.fill("Chaos");
  check("h4", "the same archetype twice is refused kindly", (await pair.innerText()).includes("Choose two different archetypes"));

  // h5. Genesys follows the deck's format.
  control.genesys = true;
  await reset();
  check("h5", "a Genesys deck asks for Genesys bridges with its points left", /format=genesys/.test(bridgeCalls.lists[0] ?? "") && /genesysRemaining=\d+/.test(bridgeCalls.lists[0] ?? ""), bridgeCalls.lists);
  check("h5", "the Genesys points of a bridge show as a warning", (await items.nth(3).getByRole("list", { name: "Warnings" }).innerText()).includes("Genesys points"));
  await shot("bridges-genesys-1920x1080");
  control.genesys = false;

  // i. Deep search: one request per click, a progress bar with named steps, resume, errors.
  await reset();
  const deepButton = bridges.getByTestId("deep-search-button");
  check("i", "Deep search starts enabled", await deepButton.isEnabled() && (await deepButton.innerText()).trim() === "Deep search");
  await deepButton.dblclick();
  await bridges.getByTestId("deep-progress").waitFor();
  check("i", "a double click starts one search", bridgeCalls.starts.length === 1, bridgeCalls.starts);
  check("i", "the search asks for the deck archetype in its format", bridgeCalls.starts[0]?.source === "Blue-Eyes" && bridgeCalls.starts[0]?.format === "advanced", bridgeCalls.starts[0]);
  check("i", "the button is off while the search runs", await deepButton.isDisabled() && (await deepButton.innerText()).includes("Searching"));
  const progress = bridges.getByTestId("deep-progress");
  check("i", "the progress bar says what it does", (await progress.innerText()).includes("Searching all possible bridges..."));
  check("i", "the progress shows the three step names", (await progress.locator("li").allInnerTexts()).join("|").replace(/\u2713\s?/g, "").replace(/\u00a0/g, "") === "Finding candidates|Checking cards|Rating", await progress.locator("li").allInnerTexts());
  await progress.locator('li[data-state="current"]', { hasText: "Rating" }).waitFor({ timeout: 10_000 });
  const value = Number(await progress.getByRole("progressbar").getAttribute("aria-valuenow"));
  check("i", "the bar fills as the steps advance", value >= 55 && value < 100, value);
  await bridges.getByTestId("deep-results").waitFor({ timeout: 15_000 });
  const deepItems = bridges.getByTestId("deep-results").getByTestId("bridge-item");
  check("i", "deep search shows at most ten results", await deepItems.count() === 10);
  check("i", "strict results precede deep-only Niche rows", JSON.stringify(await deepItems.getByTestId("bridge-grade").allInnerTexts()) === JSON.stringify(["Strong", "Good", "Niche", "Risky", ...Array(6).fill("Niche")]));
  check("i", "deep results do not expand Suggestions", await bridges.getByRole("list", { name: "Your deck can bridge into", exact: true }).getByTestId("bridge-item").count() === 4);
  check("i", "the count of bridges still in review shows", (await bridges.getByTestId("bridges-in-review").innerText()).includes("2 bridges are still in review"), await bridges.getByTestId("bridges-in-review").innerText());
  check("i", "a completed search immediately enables Search again", await deepButton.isEnabled() && (await deepButton.innerText()).trim() === "Search again", await deepButton.innerText());
  await shot("bridges-completed-1920x1080");

  // i2. Leaving and coming back resumes the running search, and starts no second one.
  await reset();
  await deepButton.click();
  await bridges.getByTestId("deep-progress").locator('li[data-state="current"]', { hasText: "Checking cards" }).waitFor({ timeout: 10_000 });
  const startsBefore = bridgeCalls.starts.length;
  await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
  await bridges.getByTestId("deep-progress").waitFor({ timeout: 15_000 });
  check("i2", "the running search shows again after a reload", await bridges.getByTestId("deep-progress").isVisible());
  await bridges.getByTestId("deep-results").waitFor({ timeout: 15_000 });
  check("i2", "it finishes with its results and sends no second start", bridgeCalls.starts.length === startsBefore, bridgeCalls.starts.length);

  // i3. The host says wait: a countdown from retryAfter and no job.
  await reset();
  // Freeze Date while timers continue, then advance it explicitly: no wall-time tolerance.
  const limitedAt = new Date("2026-10-28T12:00:00Z");
  await page.clock.setFixedTime(limitedAt);
  bridgeControl.startRetryAfter = 45;
  await deepButton.click();
  await page.waitForFunction(() => /Deep search in/.test(document.querySelector('[data-testid="deep-search-button"]')?.textContent ?? ""), null, { timeout: 5000 });
  const wait = await deepButton.innerText();
  check("i3", "a 429 turns the button into a countdown from retryAfter", await deepButton.isDisabled() && wait.trim() === "Deep search in 45 s", wait);
  await page.clock.setFixedTime(new Date(limitedAt.getTime() + 5000));
  await page.waitForFunction(() => document.querySelector('[data-testid="deep-search-button"]')?.textContent?.trim() === "Deep search in 40 s");
  check("i3", "the countdown decreases by exactly five seconds", (await deepButton.innerText()).trim() === "Deep search in 40 s");
  check("i3", "a 429 shows no progress bar", (await bridges.getByTestId("deep-progress").count()) === 0);
  check("i3", "the hint explains the wait", (await bridges.innerText()).includes("15 deep searches per hour"));
  check("i3", "the countdown survives a reload in this tab", await (async () => { await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`); await items.first().waitFor(); return (await deepButton.isDisabled()) && (await deepButton.innerText()).trim() === "Deep search in 40 s"; })());
  await shot("bridges-retry-after-1920x1080");
  await page.clock.setFixedTime(new Date(limitedAt.getTime() + 45_000));
  await page.waitForFunction(() => !(document.querySelector('[data-testid="deep-search-button"]') as HTMLButtonElement)?.disabled);
  check("i3", "the button enables exactly when retryAfter expires", await deepButton.isEnabled());

  // i4. The search fails: a clear error, no results.
  await reset();
  bridgeControl.jobMode = "fail";
  await deepButton.click();
  await bridges.getByTestId("deep-error").waitFor({ timeout: 15_000 });
  check("i4", "a failed search shows a clear error", (await bridges.getByTestId("deep-error").innerText()).includes("stopped before it finished"));
  check("i4", "a failed search immediately enables Try again", await deepButton.isEnabled() && (await deepButton.innerText()).trim() === "Try again");
  check("i4", "a failed search shows no results", (await bridges.getByTestId("deep-results").count()) === 0);
  await shot("bridges-deep-failed-1920x1080");

  // j. The list itself fails or is off.
  await reset();
  bridgeControl.none = true;
  await open("small", "on", "Bridges");
  await bridges.getByTestId("bridges-empty").waitFor({ timeout: 15_000 });
  check("j", "no bridge that passed the checks gives a plain empty state", (await bridges.getByTestId("bridges-empty").innerText()).includes("No bridge that passed our checks yet"), await bridges.getByTestId("bridges-empty").innerText());
  bridgeControl.none = false;
  bridgeControl.listStatus = 503;
  await open("small", "on", "Bridges");
  await bridges.getByRole("alert").first().waitFor({ timeout: 15_000 });
  check("j", "a failed list says so and offers Try again", (await bridges.getByRole("alert").first().innerText()).includes("not available") && (await bridges.getByRole("button", { name: "Try again" }).count()) === 1);
  bridgeControl.listStatus = 404;
  await open("small", "on", "Bridges");
  await page.waitForTimeout(1500);
  check("j", "a server with no bridges hides the row and its tab", (await bridges.count()) === 0 && (await page.getByRole("tab", { name: "Bridges", exact: true }).count()) === 0 && (await page.getByRole("tab", { name: "Suggest", exact: true }).count()) === 1 && await (async () => { await goTab("Suggest"); return true; })() && (await panel.locator('section[aria-labelledby^="suggest-"]').count()) === 4);
  bridgeControl.listStatus = 200;

  // t. The tabs: Cards | Suggest | Bridges on a desktop, Deck | Cards | Suggest | Bridges on a phone.
  const tabState = (name: string) => page.getByRole("tab", { name, exact: true }).first().getAttribute("aria-selected");
  const fresh = async (deck: "small" | "full" | "empty" = "small") => {
    control.deck = deck; insightRequests.length = 0; bridgeCalls.lists.length = 0; engineCalls.length = 0; deepJobs.clear(); bridgeCalls.polls = 0; bridgeControl.storedExtra = false; bridgeControl.pollBusy = 0;
    await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
    await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* Storage is not available. */ } });
    await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
    await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
    // The editor measures its width after the first paint, so the phone and desktop tab lists settle a moment later.
    await page.waitForTimeout(400);
  };
  /** The scroll box of the card list, the one that holds the results. */
  const cardScroller = () => page.locator('[data-pane="cards"]').evaluateHandle((pane: HTMLElement) => [...pane.querySelectorAll("div")].find((node) => getComputedStyle(node).overflowY === "auto" && node.scrollHeight > node.clientHeight + 50) ?? null);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await fresh();
  const tablist = page.getByTestId("editor-tabs-bar");
  check("t1", "a desktop shows Cards, Suggest and Bridges in a tab list", (await tablist.getByRole("tab").allInnerTexts()).map((text: string) => text.trim()).join("|") === "Cards|Suggest|Bridges");
  check("t1", "Cards is the default tab", (await tabState("Cards")) === "true" && (await tabState("Suggest")) === "false");
  await page.waitForTimeout(1500);
  check("t1", "Suggest and Bridges ask for nothing until opened", insightRequests.length === 0 && bridgeCalls.lists.length === 0, { insight: insightRequests.length, bridges: bridgeCalls.lists.length });
  check("t1", "each tab names its panel and the panel names its tab", await page.evaluate(() => [...document.querySelectorAll('[role="tablist"][data-testid="editor-tabs-bar"] [role="tab"]')].every((tab) => { const panel = document.getElementById(tab.getAttribute("aria-controls") ?? ""); return panel?.getAttribute("role") === "tabpanel" && panel.getAttribute("aria-labelledby") === tab.id; })));
  check("t1", "the Cards panel is visible and the others are empty until opened", await page.locator("#deck-editor-cards").isVisible() && (await page.locator("#deck-editor-suggest").innerHTML()) === "" && (await page.locator("#deck-editor-bridges").innerHTML()) === "");
  check("t1", "the Engines that fit slot has no chips yet", (await page.locator('[data-testid="engines-fit"]').count()) === 0);
  await shot("tabs-cards-1920x1080");

  // Arrow keys move between the tabs, wrap, and Home / End jump to the ends.
  await page.getByRole("tab", { name: "Cards", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  check("t2", "ArrowRight opens Suggest and moves focus to it", (await tabState("Suggest")) === "true" && await page.evaluate(() => document.activeElement?.id) === "deck-editor-column-suggest-tab");
  await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
  check("t2", "Suggest asks once, when it first opens", insightRequests.length === 1, insightRequests.length);
  check("t2", "Bridges still wait while Suggest is open", bridgeCalls.lists.length === 0, bridgeCalls.lists);
  await page.keyboard.press("ArrowRight");
  check("t2", "ArrowRight again opens Bridges", (await tabState("Bridges")) === "true");
  await page.keyboard.press("ArrowRight");
  check("t2", "ArrowRight on the last tab wraps to Cards", (await tabState("Cards")) === "true");
  await page.keyboard.press("End");
  check("t2", "End opens the last tab", (await tabState("Bridges")) === "true");
  await page.keyboard.press("Home");
  check("t2", "Home opens the first tab", (await tabState("Cards")) === "true");
  check("t2", "a hidden panel is hidden for the page, not only dimmed", !(await page.locator("#deck-editor-suggest").isVisible()) && await page.locator("#deck-editor-suggest").getAttribute("hidden") !== null);

  // The panes stay mounted: search text and scroll are still there when the tab comes back.
  await search().fill("dragon");
  await page.waitForTimeout(1200);
  const scroller = await cardScroller();
  const canScroll = await scroller.evaluate((node: HTMLElement | null) => node != null);
  check("t3", "the card list has a scroll box to test", canScroll);
  if (canScroll) {
    await scroller.evaluate((node: HTMLElement) => { node.scrollTop = 420; });
    const before = await scroller.evaluate((node: HTMLElement) => node.scrollTop);
    await goTab("Suggest");
    await page.waitForTimeout(300);
    await goTab("Cards");
    await page.waitForTimeout(300);
    const after = await scroller.evaluate((node: HTMLElement) => node.scrollTop);
    check("t3", "the card list keeps its scroll while another tab is open", before > 0 && Math.abs(after - before) <= 1, { before, after });
  }
  check("t3", "the search text stays", (await search().inputValue()) === "dragon");
  await search().fill("");

  // Suggest refreshes after a deck edit only while it is on screen.
  await goTab("Suggest");
  await page.waitForTimeout(900);
  const asked = insightRequests.length;
  await panel.locator('section[aria-labelledby="suggest-archetype"] button').first().dblclick();
  await page.waitForTimeout(1500);
  check("t4", "a deck edit refreshes Suggest while it is open", insightRequests.length === asked + 1, { asked, now: insightRequests.length });
  await goTab("Cards");
  const hiddenAsked = insightRequests.length;
  await page.locator('[data-pane="cards"] button[aria-label^="Add "]').first().click({ timeout: 5000 }).catch(async () => { await page.locator('[data-pane="cards"] ul button, [data-pane="cards"] [role="listitem"] button').first().dblclick(); });
  await page.waitForTimeout(1500);
  check("t4", "a deck edit does not refresh Suggest while it is hidden", insightRequests.length === hiddenAsked, { hiddenAsked, now: insightRequests.length });
  await goTab("Suggest");
  await page.waitForTimeout(1500);
  check("t4", "opening Suggest again catches up with the edit", insightRequests.length > hiddenAsked, { hiddenAsked, now: insightRequests.length });

  // The last tab is remembered.
  await goTab("Suggest");
  await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
  await page.getByRole("tab", { name: "Suggest", exact: true }).waitFor({ state: "visible", timeout: 8000 });
  check("t5", "a reload opens the tab used last", (await tabState("Suggest")) === "true");

  // A deep search that finishes while Bridges is hidden marks the tab with a dot, and opening the tab clears it.
  await fresh();
  bridgeControl.pollDelayMs = 1200;
  await goTab("Bridges");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-progress").waitFor();
  await goTab("Cards");
  check("t6", "no dot while the search runs", (await page.locator('[role="tab"][data-dot]').count()) === 0);
  await page.locator('[role="tab"][data-dot]').first().waitFor({ state: "attached", timeout: 30_000 });
  check("t6", "a dot marks the Bridges tab when the search finishes while it is hidden", (await page.getByRole("tab", { name: /^Bridges/ }).first().getAttribute("data-dot")) !== null);
  check("t6", "a screen reader hears that there are new results", (await page.getByRole("tab", { name: /^Bridges/ }).first().innerText()).includes("new results"));
  await shot("tabs-bridges-dot-1920x1080");
  await goTab("Bridges");
  await page.waitForTimeout(300);
  check("t6", "the dot is gone once the tab opens", (await page.locator('[role="tab"][data-dot]').count()) === 0);
  check("t6", "the finished results are waiting in the tab", await bridges.getByTestId("deep-results").isVisible());
  bridgeControl.pollDelayMs = 0;

  // A finish while Bridges is open leaves no dot.
  await fresh();
  await goTab("Bridges");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  check("t6", "no dot when the search finishes in the open tab", (await page.locator('[role="tab"][data-dot]').count()) === 0);

  // No tab bar when Suggestions are off.
  await open("small", "off");
  await page.waitForTimeout(800);
  check("t7", "with Suggestions off there is no tab bar", (await tablist.count()) === 0 && (await page.getByRole("tab").count()) === 0 && await page.locator("#deck-editor-cards").isVisible());

  // The phone: Deck | Cards | Suggest | Bridges in the segmented control.
  // Every tab the control marks as chosen, from the first paint on (before the editor has measured itself).
  // Plain text, so the tsx transform adds no helper the page does not have.
  await page.addInitScript({ content: `(() => {
    const seen = []; window.__segSeen = seen;
    const look = () => { const id = document.querySelector('[data-testid="editor-tabs-seg"] [role="tab"][aria-selected="true"]')?.id; if (id && seen.at(-1) !== id) seen.push(id); };
    const observer = new MutationObserver(look);
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
    setTimeout(() => observer.disconnect(), 4000);
  })();` });
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh();
  const segSeen = await page.evaluate(() => (window as unknown as { __segSeen?: string[] }).__segSeen ?? []);
  check("t8", "the phone control marks Deck from the first paint and never Cards first", JSON.stringify(segSeen) === JSON.stringify(["deck-editor-deck-tab"]), segSeen);
  const seg = page.getByTestId("editor-tabs-seg");
  const phoneTabs = (await seg.getByRole("tab").allInnerTexts()).map((text: string) => text.replace(/\s+/g, " ").trim());
  check("t8", "a phone shows Deck with its count, Cards, Suggest and Bridges", phoneTabs.length === 4 && /^Deck \d+$/.test(phoneTabs[0]!) && phoneTabs.slice(1).join("|") === "Cards|Suggest|Bridges", phoneTabs);
  check("t8", "the desktop bar is not on a phone", (await tablist.count()) === 0);
  await page.getByRole("tab", { name: "Bridges", exact: true }).click();
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("t8", "Bridges opens on a phone and the page does not scroll sideways", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot("tabs-bridges-390x844");
  await page.getByRole("tab", { name: "Suggest", exact: true }).click();
  await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
  await shot("tabs-suggest-390x844");

  // The tab bar at the other desktop sizes.
  for (const viewport of VIEWPORTS.filter((entry) => entry.width !== 390)) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fresh();
    await goTab("Suggest");
    await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(300);
    const barFits = await tablist.evaluate((node: HTMLElement) => node.scrollWidth <= node.clientWidth + 1);
    check("t9", `${viewport.name}: the tab bar fits its column`, barFits);
    check("t9", `${viewport.name}: the page does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(`tabs-suggest-${viewport.name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // u. Engine chips: the engines of the open deck, with the player's edits, for the Bridges tab only.
  engineControl.mode = "single"; engineControl.status = 200; engineControl.nextEmpty = false;
  bridgeControl.listStatus = 200; bridgeControl.none = false;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fresh();
  await goTab("Bridges");
  const chips = bridges.getByTestId("engine-chips");
  await chips.waitFor({ state: "visible", timeout: 15_000 });
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  const chipNames = async () => (await chips.getByTestId("engine-chip").allInnerTexts()).map((text: string) => text.trim());
  check("u1", "the deck's engine shows as a chip", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes"]), await chipNames());
  check("u1", "the host was asked once, with the deck and no engines", engineCalls.length === 1 && engineCalls[0]!.deck?.main?.length > 0 && engineCalls[0]!.engines === undefined, engineCalls.map((call) => Object.keys(call)));
  check("u1", "a group only in part in the deck waits under Also in deck", (await chips.getByTestId("engine-also").innerText()).replace(/\s+/g, " ").includes("Also in deck: Dragunity 2"), await chips.getByTestId("engine-also").innerText());
  check("u1", "one engine keeps its own bridge list", (await bridges.getByRole("list", { name: "Your deck can bridge into", exact: true }).getByTestId("bridge-item").count()) === 4 && (await bridges.getByTestId("engines-next").count()) === 0);
  check("u1", "nothing is edited yet, so there is no reset link", (await chips.getByTestId("engine-reset").count()) === 0);

  await chips.getByRole("button", { name: /^Add Dragunity/ }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  check("u2", "a second engine joins as a chip", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes", "Dragunity"]), await chipNames());
  check("u2", "the host is asked again with the corrected set and the deck", engineCalls.length === 2 && JSON.stringify(engineCalls[1]!.engines) === JSON.stringify(["Blue-Eyes", "Dragunity"]) && engineCalls[1]!.deck?.main?.length > 0, engineCalls[1]);
  check("u2", "the light group left the list", (await chips.getByTestId("engine-also").count()) === 0);
  const between = bridges.getByTestId("engines-between");
  check("u2", "Bridges between your engines lists both directions", (await between.locator("h4").innerText()) === "Bridges between your engines" && JSON.stringify(await between.getByTestId("bridge-item").locator("strong").allInnerTexts()) === JSON.stringify(["Blue-Eyes → Dragunity", "Dragunity → Blue-Eyes"]), await between.getByTestId("bridge-item").locator("strong").allInnerTexts());
  const nexts = bridges.getByTestId("engines-next");
  const engineItems = nexts.getByTestId("engine-item");
  check("u2", "the next engine section names the set", (await nexts.locator("h4").innerText()) === "Next engine for Blue-Eyes + Dragunity", await nexts.locator("h4").innerText());
  check("u2", "engines come best first", JSON.stringify(await engineItems.locator("strong").allInnerTexts()) === JSON.stringify(["Chaos", "Dragon Ruler", "Red-Eyes", "Dark Magician"]), await engineItems.locator("strong").allInnerTexts());
  const chaos = engineItems.first();
  check("u2", "an engine shows its grade and how many engines it links to", (await chaos.getByTestId("engine-grade").innerText()) === "Good" && (await chaos.getByTestId("engine-covered").innerText()) === "Links 2 of 2");
  const paths = (await chaos.getByTestId("engine-paths").innerText()).replace(/\s+/g, " ");
  check("u2", "an engine shows the access path of each link", paths.includes("Blue-Eyes → Chaos") && paths.includes("Dragunity → Chaos") && paths.includes("Monster Reborn"), paths);
  check("u2", "an engine shows its cards and what the deck lacks", (await chaos.getByRole("list", { name: "Chaos cards" }).locator("li").count()) >= 5 && /to add/.test(await chaos.getByTestId("engine-need").innerText()), await chaos.getByTestId("engine-need").innerText());
  check("u2", "an engine shows good and bad points", (await chaos.getByRole("list", { name: "Good" }).locator("li").count()) >= 1 && (await chaos.getByRole("list", { name: "Bad" }).locator("li").count()) >= 1);
  check("u2", "only a two-way engine gets the two-way badge", (await chaos.getByTestId("engine-two-way").count()) === 0 && (await engineItems.nth(2).getByTestId("engine-two-way").count()) === 1);
  check("u2", "the single-engine list is replaced", (await bridges.getByRole("list", { name: "Your deck can bridge into", exact: true }).count()) === 0);
  await shot("engines-two-1920x1080");

  // Taking the added engine away again is no edit at all: the first answer is the answer.
  const callsBefore = engineCalls.length;
  await chips.getByRole("button", { name: "Remove Dragunity" }).click();
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("u3", "removing the added engine goes back to one chip", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes"]), await chipNames());
  check("u3", "that asks the host for nothing new", engineCalls.length === callsBefore, engineCalls.length - callsBefore);
  check("u3", "no edit is left, so no reset link", (await chips.getByTestId("engine-reset").count()) === 0);

  // The deck keeps one engine: the last chip has no working ×. Removing the deck's own engine is an edit, and Reset to deck brings it back.
  check("u4", "the last engine of the deck cannot be removed", await chips.getByRole("button", { name: "Remove Blue-Eyes" }).isDisabled());
  await chips.getByRole("button", { name: /^Add Dragunity/ }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  check("u4", "the + of Also in deck gives the focus to the new chip", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "Remove Dragunity", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")));
  await chips.getByRole("button", { name: "Remove Blue-Eyes" }).click();
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("u4", "a removed deck engine leaves the other chip and shows the reset link", JSON.stringify(await chipNames()) === JSON.stringify(["Dragunity"]) && (await chips.getByTestId("engine-reset").innerText()) === "Reset to deck", await chipNames());
  check("u4", "the reset link is outside the chip list, so a screen reader counts the chips only", (await chips.getByRole("list").first().getByTestId("engine-reset").count()) === 0 && (await chips.getByRole("listitem").count()) === (await chips.getByTestId("engine-chip").count()) + (await chips.getByTestId("engine-add").count()));
  check("u4", "the reset link is a short inline link in the row of the chips", await chips.evaluate((root: HTMLElement) => { const link = root.querySelector('[data-testid="engine-reset"]')!.getBoundingClientRect(); const list = root.querySelector("ul")!.getBoundingClientRect(); return link.width < 160 && link.top < list.bottom && link.left >= list.right - 1; }));
  await chips.scrollIntoViewIfNeeded();
  await shot("chips-reset-1920x1080");
  await shot("engines-reset-1920x1080");
  check("u4", "the focus goes on after a chip is removed", await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "engine-add", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  await chips.getByTestId("engine-reset").click();
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("u4", "Reset to deck puts the engine back", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes"]) && (await chips.getByTestId("engine-reset").count()) === 0);

  // + Add takes any archetype by name.
  await chips.getByTestId("engine-add").click();
  const adder = bridges.getByTestId("engine-add-form");
  const box = adder.getByRole("combobox");
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox", null, { timeout: 5000 }).catch(() => undefined);
  check("u5", "+ Add puts the focus in the name box", await page.evaluate(() => document.activeElement?.getAttribute("role")) === "combobox");
  await box.fill("chao");
  await adder.getByRole("option", { name: "Chaos" }).waitFor();
  check("u5", "the combo lists the archetypes that fit and leaves out the chosen ones", (await adder.getByRole("option").allInnerTexts()).includes("Chaos") && !(await adder.getByRole("option").allInnerTexts()).includes("Blue-Eyes"));
  check("u5", "Add stays off until the text is a whole name", await adder.getByRole("button", { name: "Add", exact: true }).isDisabled());
  await box.press("Enter");
  await adder.getByRole("button", { name: "Add", exact: true }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  check("u5", "the named archetype becomes a chip", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes", "Chaos"]), await chipNames());
  check("u5", "after Add the focus is back on the Add chip", await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "engine-add");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  check("u5", "the host got the new set", JSON.stringify(engineCalls.at(-1)!.engines) === JSON.stringify(["Blue-Eyes", "Chaos"]), engineCalls.at(-1));

  // Four is the most.
  await chips.getByTestId("engine-add").click();
  await box.fill("Dragunity");
  await adder.getByRole("button", { name: "Add", exact: true }).click();
  await chips.getByTestId("engine-add").click();
  await box.fill("Dark Magician");
  await adder.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(300);
  check("u6", "four chips are the most", (await chips.getByTestId("engine-chip").count()) === 4 && (await chips.getByTestId("engine-add").count()) === 0 && (await chips.innerText()).includes("Four engines is the most"), await chipNames());
  check("u6", "the host is never asked for more than four", engineCalls.every((call) => !call.engines || call.engines.length <= 4));
  await shot("engines-four-1920x1080");

  // The host finds two engines: two chips and a group under Also in deck.
  engineControl.mode = "multi";
  await fresh();
  await goTab("Bridges");
  await chips.waitFor({ state: "visible", timeout: 15_000 });
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  check("u7", "two detected engines show as two chips", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes", "Dragunity"]), await chipNames());
  check("u7", "the first answer is enough, so the host is asked once", engineCalls.length === 1, engineCalls.length);
  check("u7", "the light group is offered", (await chips.getByTestId("engine-also").innerText()).includes("Chaos"));

  // The size of the chips and the cards at every width.
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fresh();
    await goTab("Bridges");
    await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await bridges.scrollIntoViewIfNeeded();
    check("u8", `${viewport.name}: the page does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const fit = await bridges.evaluate((root: HTMLElement) => { const edge = root.getBoundingClientRect().right + 1; return [...root.querySelectorAll('[data-testid="engine-chip"], [data-testid="engine-item"], [data-testid="bridge-item"]')].every((node) => node.getBoundingClientRect().right <= edge); });
    check("u8", `${viewport.name}: chips and cards stay inside the column`, fit);
    await shot(`engines-${viewport.name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // The fast call fails or the server has no bridges.
  engineControl.mode = "single"; engineControl.status = 500;
  await fresh();
  await goTab("Bridges");
  await bridges.getByRole("alert").first().waitFor({ timeout: 15_000 });
  check("u9", "a failed engine answer says so and offers Try again", (await bridges.getByRole("alert").first().innerText()).includes("not available") && (await bridges.getByRole("button", { name: "Try again" }).count()) === 1);
  engineControl.status = 404;
  await fresh();
  await page.waitForTimeout(300);
  await goTab("Bridges");
  await page.waitForTimeout(600);
  check("u9", "a server with no bridges hides the row and its tab", (await bridges.count()) === 0 && (await page.getByRole("tab", { name: "Bridges", exact: true }).count()) === 0);
  engineControl.status = 200;

  // v. Engines that fit: the top row of the Suggest tab.
  engineControl.mode = "single"; engineControl.status = 200; engineControl.nextEmpty = false; engineControl.delayMs = 0;
  bridgeControl.listStatus = 200; bridgeControl.none = false;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fresh();
  await goTab("Suggest");
  const fit = page.getByTestId("engines-fit");
  await fit.getByTestId("engine-fit-item").first().waitFor({ state: "visible", timeout: 15_000 });
  const fitItems = fit.getByTestId("engine-fit-item");
  check("v1", "the row is the first in the Suggest tab", (await panel.locator("h3").first().innerText()) === "Engines that fit", await panel.locator("h3").allInnerTexts());
  check("v1", "it shows the top three engines, best first", JSON.stringify(await fitItems.locator("strong").allInnerTexts()) === JSON.stringify(["Dragunity", "Dragon Ruler", "Chaos"]), await fitItems.locator("strong").allInnerTexts());
  check("v1", "each engine shows a grade and names the deck engine it links", (await fitItems.first().getByTestId("engine-fit-grade").innerText()).length > 0 && (await fitItems.first().getByTestId("engine-fit-links").innerText()) === "Links Blue-Eyes", await fitItems.first().innerText());
  check("v1", "each engine shows small cards", (await fitItems.first().getByRole("list", { name: /cards$/ }).locator("li").count()) >= 2);
  check("v1", "the row asked the host once", engineCalls.length === 1, engineCalls.length);
  const callsAtSuggest = engineCalls.length;
  await shot("fit-1920x1080");

  // A tap opens the engine in the Bridges tab; Bridges shares the answer, so the host is not asked again.
  await fitItems.first().getByRole("button", { name: /Open in Bridges/ }).click();
  check("v2", "the Bridges tab opens", (await tabState("Bridges")) === "true");
  await bridges.getByTestId("bridge-drill").waitFor({ timeout: 15_000 });
  check("v2", "the bridge to that engine opens its details", (await bridges.getByTestId("bridge-drill").innerText()).includes("Dragunity"), await bridges.getByTestId("bridge-drill").innerText());
  check("v2", "the Bridges tab reused the answer of Suggest", engineCalls.length === callsAtSuggest, engineCalls.length - callsAtSuggest);
  check("v2", "the focus is on Back in the details that opened", await page.evaluate(() => /^Back/.test(document.activeElement?.textContent ?? "")));

  // A tap from Suggest leaves Pick mode: the deck's engine, not the picks, shows the tapped engine.
  await bridges.getByRole("button", { name: /^Back/ }).click();
  await page.waitForTimeout(100);
  check("v2", "Back from an asked bridge leaves the focus in the tab", await page.evaluate(() => document.activeElement !== document.body && !!document.activeElement?.closest('[data-testid="bridges-row"]')), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  await bridges.getByTestId("engine-modes").getByRole("button", { name: "Pick archetypes" }).click();
  await bridges.getByTestId("engine-add").click();
  await bridges.getByTestId("engine-add-form").getByRole("combobox").fill("Red-Eyes");
  await bridges.getByTestId("engine-add-form").getByRole("button", { name: "Add", exact: true }).click();
  await goTab("Suggest");
  await fitItems.nth(2).getByRole("button", { name: /Open in Bridges/ }).click();
  await bridges.getByTestId("bridge-drill").waitFor({ timeout: 15_000 });
  check("v2", "a tap while Bridges is in Pick mode goes back to the deck and opens the engine", (await bridges.getByTestId("engine-modes").count()) === 0 && (await bridges.getByTestId("bridge-drill").innerText()).includes("Chaos"), await bridges.getByTestId("bridge-drill").innerText());
  await bridges.getByRole("button", { name: /^Back/ }).click();
  check("v2", "Back from there shows Use my deck", (await bridges.getByTestId("engine-modes").getByRole("button", { name: "Use my deck" }).getAttribute("aria-pressed")) === "true");

  // With two engines, the tap shows the engine card in the Bridges list.
  engineControl.mode = "multi";
  await fresh();
  await goTab("Suggest");
  await fit.getByTestId("engine-fit-item").first().waitFor({ state: "visible", timeout: 15_000 });
  const multiFirst = await fit.getByTestId("engine-fit-item").first().getAttribute("data-engine");
  check("v3", "two engines still show a short list that names both linked engines", (await fit.getByTestId("engine-fit-item").count()) <= 3 && (await fit.getByTestId("engine-fit-links").first().innerText()) === "Links Blue-Eyes + Dragunity", await fit.innerText());
  await fit.getByTestId("engine-fit-item").first().getByRole("button", { name: /Open in Bridges/ }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  await bridges.locator(`[data-testid="engine-item"][data-lit]`).waitFor({ timeout: 5000 });
  check("v3", "the tapped engine is marked in the Bridges list", (await bridges.locator('[data-testid="engine-item"][data-lit]').getAttribute("data-engine")) === multiFirst, multiFirst);
  await page.waitForTimeout(200);
  check("v3", "the marked engine has the focus", await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.engine ?? null) === multiFirst, await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));

  // With edited chips the tapped engine can be a chip already, or not a next engine: a line says so and offers a reset.
  await bridges.getByTestId("engine-chips").getByRole("button", { name: /^Add Chaos/ }).click();
  await bridges.getByTestId("engines-next").locator("h4", { hasText: "Chaos" }).waitFor({ timeout: 15_000 });
  await goTab("Suggest");
  await fit.getByTestId("engine-fit-item").first().getByRole("button", { name: /Open in Bridges/ }).click();
  await bridges.getByTestId("bridges-notice").waitFor({ timeout: 10_000 });
  check("v3", "a tapped engine that is a chip already gets a short line", (await bridges.getByTestId("bridges-notice").innerText()).includes("Chaos is already one of your engines"), await bridges.getByTestId("bridges-notice").innerText());
  // Only Red-Eyes is left: nothing in the stored rows leads from it to Chaos.
  await bridges.getByTestId("engine-chips").getByRole("button", { name: "Remove Chaos" }).click();
  await bridges.getByTestId("engine-chips").getByTestId("engine-add").click();
  await bridges.getByTestId("engine-add-form").getByRole("combobox").fill("Red-Eyes");
  await bridges.getByTestId("engine-add-form").getByRole("button", { name: "Add", exact: true }).click();
  await bridges.getByTestId("engine-chips").getByRole("button", { name: "Remove Blue-Eyes" }).click();
  await bridges.getByTestId("engine-chips").getByRole("button", { name: "Remove Dragunity" }).click();
  await bridges.getByTestId("bridges-empty").waitFor({ timeout: 15_000 });
  await goTab("Suggest");
  await fit.getByTestId("engine-fit-item").first().getByRole("button", { name: /Open in Bridges/ }).click();
  await bridges.getByTestId("bridges-notice").waitFor({ timeout: 10_000 });
  check("v3", "a tapped engine that the edited chips do not reach says so, with a reset", (await bridges.getByTestId("bridges-notice").innerText()).includes("not a next engine") && (await bridges.getByTestId("bridges-notice-reset").count()) === 1, await bridges.getByTestId("bridges-notice").innerText());
  check("v3", "the line has the focus", await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "bridges-notice");
  await bridges.getByTestId("bridges-notice-reset").click();
  await bridges.locator('[data-testid="engine-item"][data-lit]').waitFor({ timeout: 10_000 });
  check("v3", "the reset brings the deck's engines back and marks the engine", (await bridges.locator('[data-testid="engine-item"][data-lit]').getAttribute("data-engine")) === multiFirst && (await bridges.getByTestId("engine-chip").count()) === 2);

  // No engine passed the checks: a plain hint that points to Deep search.
  engineControl.mode = "single"; engineControl.nextEmpty = true;
  await fresh();
  await goTab("Suggest");
  await fit.getByTestId("engines-fit-empty").waitFor({ timeout: 15_000 });
  const emptyText = await fit.getByTestId("engines-fit-empty").innerText();
  check("v4", "the empty state points to Deep search in the Bridges tab", emptyText.includes("Deep search") && emptyText.includes("Bridges tab"), emptyText);
  check("v4", "the empty state is not an error", (await fit.getByRole("alert").count()) === 0);
  await shot("fit-empty-1920x1080");
  await fit.getByRole("button", { name: /Deep search/ }).click();
  check("v4", "its link opens the Bridges tab", (await tabState("Bridges")) === "true");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "deep-search-button", null, { timeout: 10_000 }).catch(() => undefined);
  check("v4", "the Deep search button has the focus and works", await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "deep-search-button" && await bridges.getByTestId("deep-search-button").isEnabled());
  engineControl.nextEmpty = false;

  // No engine in the deck: the hint points to Pick archetypes, never to a Deep search that is off.
  engineControl.mode = "none";
  await fresh();
  await goTab("Suggest");
  await fit.getByTestId("engines-fit-empty").waitFor({ timeout: 15_000 });
  const noneText = await fit.getByTestId("engines-fit-empty").innerText();
  check("v4", "a deck with no engine gets a hint to pick archetypes", noneText.includes("pick archetypes") && !noneText.includes("Deep search"), noneText);
  await fit.getByRole("button", { name: /pick archetypes/ }).click();
  await bridges.getByTestId("engine-add").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(200);
  check("v4", "its link opens Bridges in Pick archetypes with the focus on Add", (await bridges.getByTestId("engine-modes").getByRole("button", { name: "Pick archetypes" }).getAttribute("aria-pressed")) === "true" && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "engine-add");
  engineControl.mode = "single";

  // The host fails: the rest of Suggest still works.
  engineControl.status = 500;
  await fresh();
  await goTab("Suggest");
  await fit.getByTestId("engines-fit-empty").waitFor({ timeout: 15_000 });
  check("v5", "a failed answer says the engines are not available and offers Try again in place", (await fit.getByTestId("engines-fit-empty").innerText()).includes("not available") && (await fit.getByRole("button", { name: "Try again" }).count()) === 1 && !(await fit.getByTestId("engines-fit-empty").innerText()).includes("Deep search"));
  check("v5", "the four rows still load", (await tileButtons.count()) > 0 || await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().isVisible());
  engineControl.status = 404;
  await fresh();
  await goTab("Suggest");
  await page.waitForTimeout(800);
  check("v5", "a server with no bridges has no row", (await fit.count()) === 0);
  engineControl.status = 200;

  // The row at every width.
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fresh();
    await goTab("Suggest");
    await fit.getByTestId("engine-fit-item").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(400);
    check("v6", `${viewport.name}: the page does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const inside = await fit.evaluate((root: HTMLElement) => { const edge = root.getBoundingClientRect().right + 1; return [...root.querySelectorAll("li, button")].every((node) => node.getBoundingClientRect().right <= edge); });
    check("v6", `${viewport.name}: the engines stay inside the column`, inside);
    await shot(`fit-${viewport.name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // w. Deep search on a set of engines.
  engineControl.mode = "multi"; engineControl.status = 200; engineControl.nextEmpty = false;
  Object.assign(bridgeControl, { startRetryAfter: 0, jobMode: "ok", deepNone: false, pollDelayMs: 0 });
  bridgeCalls.polls = 0;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  bridgeCalls.starts.length = 0; bridgeCalls.polls = 0;
  await bridges.getByTestId("deep-search-button").dblclick();
  await bridges.getByTestId("deep-progress").waitFor();
  check("w1", "two engines in the deck start one search, for the chips on screen with the deck as context", bridgeCalls.starts.length === 1 && bridgeCalls.starts[0]!.deck !== undefined && JSON.stringify(bridgeCalls.starts[0]!.engines) === JSON.stringify(["Blue-Eyes", "Dragunity"]) && bridgeCalls.starts[0]!.source === undefined && bridgeCalls.starts[0]!.format === "advanced" && bridgeCalls.starts[0]!.join === undefined, bridgeCalls.starts.map((call) => Object.keys(call)));
  check("w1", "the Deep search button and its progress sit above the engine list", await bridges.evaluate((root: HTMLElement) => { const button = root.querySelector('[data-testid="deep-search-button"]')!.getBoundingClientRect(); const list = root.querySelector('[data-testid="engines-next"]')?.getBoundingClientRect(); return !!list && button.bottom <= list.top; }));
  check("w1", "the progress bar and its steps show", (await bridges.getByTestId("deep-progress").getByRole("progressbar").count()) === 1 && (await bridges.getByTestId("deep-progress").locator("li").count()) === 3);
  check("w1", "the button waits while the search runs", await bridges.getByTestId("deep-search-button").isDisabled());
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  const deepEngines = bridges.getByTestId("deep-results").getByTestId("engine-item");
  check("w1", "the results are engines that fit the whole set", (await deepEngines.count()) >= 1 && (await deepEngines.first().innerText()).includes("Links 2 of 2"), await deepEngines.allInnerTexts());
  check("w1", "no single-bridge card sits in the results", (await bridges.getByTestId("deep-results").getByTestId("bridge-item").count()) === 0);
  check("w1", "a result shows its path, cards, and good and bad points", (await deepEngines.first().getByTestId("engine-paths").count()) === 1 && (await deepEngines.first().getByRole("list", { name: /cards$/ }).count()) === 1 && (await deepEngines.first().getByRole("list", { name: "Good" }).count()) === 1);
  check("w1", "the deep search stays in the engine order the host gave", JSON.stringify(await deepEngines.locator("strong").allInnerTexts()) === JSON.stringify(["Chaos", "Dragon Ruler", "Red-Eyes", "Dark Magician"]), await deepEngines.locator("strong").allInnerTexts());
  check("w1", "the deep results take the place of the fast list, so no engine shows twice", (await bridges.getByTestId("engines-next").count()) === 0 && (await bridges.getByTestId("engine-item").count()) === (await deepEngines.count()), { fast: await bridges.getByTestId("engines-next").count(), all: await bridges.getByTestId("engine-item").count() });
  await shot("deep-engines-1920x1080");

  // A tab that is left and opened again picks the same search up, and a reload finds the job of this browser tab.
  await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
  await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(400);
  await goTab("Bridges");
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  check("w2", "a reload picks the finished search up from the kept job", (await bridges.getByTestId("deep-results").getByTestId("engine-item").count()) >= 1 && bridgeCalls.starts.length === 1, bridgeCalls.starts.length);

  // A deck edit after the search: the host hears of the new deck (the same job, no new search) and the results follow it.
  const needBefore = await bridges.getByTestId("deep-results").getByTestId("engine-item").first().getByTestId("engine-need").innerText();
  await goTab("Cards");
  await search().fill("Chaos Sorcerer");
  await page.locator('[data-pane="cards"] button[title="Chaos Sorcerer"]').first().dblclick({ timeout: 10_000 });
  await search().fill("");
  await goTab("Bridges");
  await page.waitForTimeout(2500);
  const needAfter = await bridges.getByTestId("deep-results").getByTestId("engine-item").first().getByTestId("engine-need").innerText().catch(() => "");
  check("w2", "a deck edit after the search sends the new deck to the same search, and no progress bar or dot shows", bridgeCalls.starts.length === 2 && bridgeCalls.starts[1]!.deck !== undefined && bridgeCalls.starts[1]!.join === true && (await bridges.getByTestId("deep-progress").count()) === 0 && (await page.locator('[role="tab"][data-dot]').count()) === 0, { starts: bridgeCalls.starts.length });
  check("w2", "the results then count the card the deck holds now", needAfter !== "" && needAfter !== needBefore, { needBefore, needAfter });

  // A running search is never lost: Pick archetypes shows it as still running, the button waits, and it lands on the way back.
  await fresh();
  bridgeControl.pollDelayMs = 900;
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-progress").waitFor();
  await bridges.getByTestId("engine-modes").getByRole("button", { name: "Pick archetypes" }).click();
  await bridges.getByTestId("deep-elsewhere").waitFor({ timeout: 5000 });
  check("w7", "another set shows that the first search still runs, by name", (await bridges.getByTestId("deep-elsewhere").innerText()).includes("Blue-Eyes + Dragunity"), await bridges.getByTestId("deep-elsewhere").innerText());
  for (const name of ["Chaos", "Red-Eyes"]) {
    await bridges.getByTestId("engine-add").click();
    await bridges.getByTestId("engine-add-form").getByRole("combobox").fill(name);
    await bridges.getByTestId("engine-add-form").getByRole("button", { name: "Add", exact: true }).click();
  }
  check("w7", "the button waits while the other search runs, so no 409 can show as a failure", await bridges.getByTestId("deep-search-button").isDisabled() && (await bridges.getByTestId("deep-error").count()) === 0);
  await bridges.getByTestId("deep-elsewhere").waitFor({ state: "detached", timeout: 20_000 });
  check("w7", "when it ends, the button works for the picks", await bridges.getByTestId("deep-search-button").isEnabled());
  await bridges.getByTestId("engine-modes").getByRole("button", { name: "Use my deck" }).click();
  await bridges.getByTestId("deep-results").waitFor({ timeout: 10_000 });
  check("w7", "back on the deck, the results of the first search are there", (await bridges.getByTestId("deep-results").getByTestId("engine-item").count()) >= 1);
  bridgeControl.pollDelayMs = 0;

  // A search of this player from another browser tab: a 409 is a wait with its reason, never a failed progress bar.
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  deepJobs.set(JSON.stringify(["multi", ["chaos", "red-eyes"], "advanced"]), { id: "job-other-tab", done: false });
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-notice").waitFor({ timeout: 10_000 });
  check("w8", "a 409 shows its reason and no failed bar", (await bridges.getByTestId("deep-notice").innerText()).includes("still running") && (await bridges.getByTestId("deep-progress").count()) === 0 && (await bridges.getByTestId("deep-error").count()) === 0, await bridges.getByTestId("deep-notice").innerText());
  deepJobs.clear();

  // A corrected set is sent by name, in one selector.
  engineControl.mode = "single";
  await fresh();
  await goTab("Bridges");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  bridgeCalls.starts.length = 0;
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  check("w3", "one engine keeps the source selector and its bridge results", bridgeCalls.starts.length === 1 && bridgeCalls.starts[0]!.source === "Blue-Eyes" && bridgeCalls.starts[0]!.engines === undefined && (await bridges.getByTestId("deep-results").getByTestId("bridge-item").count()) > 0, bridgeCalls.starts);
  await fresh();
  await goTab("Bridges");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  await bridges.getByTestId("engine-chips").getByTestId("engine-add").click();
  await bridges.getByTestId("engine-add-form").getByRole("combobox").fill("Chaos");
  await bridges.getByTestId("engine-add-form").getByRole("button", { name: "Add", exact: true }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  bridgeCalls.starts.length = 0;
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  check("w3", "a changed set is sent by name, with the deck as context", bridgeCalls.starts.length === 1 && JSON.stringify(bridgeCalls.starts[0]!.engines) === JSON.stringify(["Blue-Eyes", "Chaos"]) && bridgeCalls.starts[0]!.deck !== undefined && bridgeCalls.starts[0]!.source === undefined, bridgeCalls.starts);
  // Taking an engine out of the set forgets the search of the old set.
  await bridges.getByTestId("engine-chips").getByRole("button", { name: "Remove Chaos" }).click();
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("w3", "a new set starts clean", (await bridges.getByTestId("deep-results").count()) === 0 && (await bridges.getByTestId("deep-search-button").isEnabled()));

  // The hourly limit still shows its count-down for a set.
  engineControl.mode = "multi";
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  bridgeControl.startRetryAfter = 45;
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByRole("button", { name: /^Deep search in/ }).waitFor({ timeout: 10_000 });
  check("w4", "the limit shows a countdown and the 15 per hour hint", (await bridges.innerText()).includes("15 deep searches per hour"));
  bridgeControl.startRetryAfter = 0;

  // A search with no engine that passed the checks.
  bridgeControl.deepNone = true;
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-none").waitFor({ timeout: 20_000 });
  check("w5", "an empty result names the set", (await bridges.getByTestId("deep-none").innerText()).includes("Blue-Eyes + Dragunity"), await bridges.getByTestId("deep-none").innerText());
  bridgeControl.deepNone = false;

  // The results at every width.
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fresh();
    await goTab("Bridges");
    await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
    await bridges.getByTestId("deep-search-button").click();
    await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
    await bridges.getByTestId("deep-results").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    check("w6", `${viewport.name}: the page does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const inside = await bridges.evaluate((root: HTMLElement) => { const edge = root.getBoundingClientRect().right + 1; return [...root.querySelectorAll('[data-testid="deep-results"] li')].every((node) => node.getBoundingClientRect().right <= edge); });
    check("w6", `${viewport.name}: the engine results stay inside the column`, inside);
    await shot(`deep-engines-${viewport.name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // w9. The deep search finds an engine the fast list did not have: it alone is marked New, and the mark stays after
  // the fast answer is asked again (that answer then holds the stored row too).
  bridgeControl.deepExtra = true;
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fresh();
    await goTab("Bridges");
    await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
    await bridges.getByTestId("deep-search-button").click();
    await bridges.getByTestId("deep-results").getByTestId("engine-item").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const marked = await bridges.getByTestId("engine-new").evaluateAll((nodes: Element[]) => nodes.map((node) => node.closest('[data-testid="engine-item"]')?.getAttribute("data-engine")));
    check("w9", `${viewport.name}: only the engine the deep search found is marked New, and the mark stays after the fast list is asked again`, JSON.stringify(marked) === JSON.stringify(["Melodious"]) && (await bridges.getByTestId("deep-from").innerText()).includes("1 new") && engineCalls.length >= 2, { marked, engineCalls: engineCalls.length });
    await bridges.getByTestId("deep-results").scrollIntoViewIfNeeded();
    await shot(`deep-new-${viewport.name}`);
    if (viewport.width === 1920) {
      // After a reload the list from before the search is gone: no mark shows, and no wrong one.
      await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
      await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
      await page.waitForTimeout(400);
      await goTab("Bridges");
      await bridges.getByTestId("deep-results").getByTestId("engine-item").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      check("w9", "after a reload no engine is marked New, and the note does not count new ones", (await bridges.getByTestId("engine-new").count()) === 0 && !(await bridges.getByTestId("deep-from").innerText()).includes("new"), await bridges.getByTestId("deep-from").innerText());
      // Suggest lists Dragon Ruler (a fast engine) that the deep results left out: a tap says so, never nothing.
      await goTab("Suggest");
      const ruler = fit.locator('[data-testid="engine-fit-item"][data-engine="Dragon Ruler"]');
      await ruler.waitFor({ state: "visible", timeout: 15_000 });
      await ruler.getByRole("button", { name: /Open in Bridges/ }).click();
      await bridges.getByTestId("bridges-notice").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(200);
      check("w9", "a tapped engine that the deep results left out gets a line with the focus", (await bridges.getByTestId("bridges-notice").innerText()).includes("not among your deep search results") && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "bridges-notice", await bridges.getByTestId("bridges-notice").innerText());
    }
  }
  bridgeControl.deepExtra = false;
  await page.setViewportSize({ width: 1920, height: 1080 });

  // w10. A kept job measured against another deck. Fresh enough: a reload sends this deck to the same job, quietly.
  // Too old to refresh: the stale line shows and nothing is sent. A busy host on the way back is asked again.
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  bridgeCalls.starts.length = 0;
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  const keptKey = `bridges:job:${JSON.stringify(["multi", ["blue-eyes", "dragunity"], "advanced"])}`;
  const editKept = (age: number) => page.evaluate(([key, ms]: [string, number]) => {
    const kept = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    sessionStorage.setItem(key, JSON.stringify({ ...kept, context: JSON.stringify(["another deck", -1]), doneAt: Date.now() - ms }));
  }, [keptKey, age] as [string, number]);
  const reopen = async () => {
    await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
    await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(400);
    await goTab("Bridges");
  };
  await editKept(60_000);
  bridgeControl.pollBusy = 2;
  await reopen();
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  check("w10", "a busy host on the way back is asked again, and the kept results show", bridgeControl.pollBusy === 0 && await bridges.getByTestId("deep-results").isVisible());
  check("w10", "a reload with a kept job for another deck sends this deck to the same job, with no progress bar and no stale line", bridgeCalls.starts.length === 2 && bridgeCalls.starts[1]!.deck !== undefined && bridgeCalls.starts[1]!.join === true && (await bridges.getByTestId("deep-progress").count()) === 0 && (await bridges.getByTestId("deep-stale").count()) === 0, { starts: bridgeCalls.starts.length });
  await editKept(10 * 60_000);
  await reopen();
  await bridges.getByTestId("deep-stale").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  check("w10", "a kept job too old to refresh says the cards changed and sends nothing", bridgeCalls.starts.length === 2 && (await bridges.getByTestId("deep-results").count()) === 0 && (await bridges.getByTestId("deep-search-button").innerText()).includes("Search again"), { starts: bridgeCalls.starts.length });
  await shot("deep-stale-1920x1080");
  engineControl.mode = "single";

  // w11. The refresh for an edited deck is join-only. The host may refuse it (404: nothing to join, 409: another search
  // runs). That is quiet: the stale line stays, no error shows, no search starts, and a click then sends no join.
  for (const refused of [404, 409]) {
    engineControl.mode = "multi";
    await fresh();
    await goTab("Bridges");
    await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
    bridgeCalls.starts.length = 0;
    await bridges.getByTestId("deep-search-button").click();
    await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
    bridgeControl.joinStatus = refused;
    await goTab("Cards");
    await search().fill("Chaos Sorcerer");
    await page.locator('[data-pane="cards"] button[title="Chaos Sorcerer"]').first().dblclick({ timeout: 10_000 });
    await search().fill("");
    await goTab("Bridges");
    await bridges.getByTestId("deep-stale").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    check("w11", `a refused join (${refused}) is tried once, quietly: the stale line shows and nothing else`, bridgeCalls.starts.length === 2 && bridgeCalls.starts[1]!.join === true && (await bridges.getByTestId("deep-error").count()) === 0 && (await bridges.getByTestId("deep-notice").count()) === 0 && (await bridges.getByTestId("deep-progress").count()) === 0 && (await bridges.getByTestId("deep-results").count()) === 0, bridgeCalls.starts.map((call) => call.join));
    bridgeControl.joinStatus = 0;
    await bridges.getByTestId("deep-search-button").click();
    await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
    check("w11", `a click on Deep search after a refused join (${refused}) sends no join`, bridgeCalls.starts.length === 3 && bridgeCalls.starts[2]!.join === undefined, bridgeCalls.starts.map((call) => call.join));
  }
  engineControl.mode = "single";

  // y. The Domain formats have no Bridges: no tab (desktop or phone), no Engines that fit row, and no request.
  control.genesys = false; engineControl.mode = "multi";
  for (const [format, genesysOn] of [["domain", false], ["domain", true]] as const) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      control.mode = format; control.genesys = genesysOn;
      await fresh();
      // The remembered tab was Bridges: it falls back to Cards.
      await page.evaluate(() => { try { localStorage.setItem("deck-editor:tab", "bridges"); } catch { /* No storage. */ } });
      bridgeCalls.lists.length = 0; engineCalls.length = 0; bridgeCalls.starts.length = 0; bridgeCalls.archetypes = 0;
      await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
      await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
      await page.waitForTimeout(600);
      const label = `${genesysOn ? "Genesys Domain" : "Domain"} ${viewport.name}`;
      check("y1", `${label}: there is no Bridges tab`, (await page.getByRole("tab", { name: "Bridges", exact: true }).count()) === 0, await page.getByRole("tab").allInnerTexts());
      check("y1", `${label}: the remembered Bridges tab falls back to Cards`, (await page.getByRole("tab", { name: "Cards", exact: true }).first().getAttribute("aria-selected")) === "true" || viewport.width === 390);
      await goTab("Suggest");
      await page.waitForTimeout(800);
      check("y1", `${label}: Suggest has no Engines that fit row`, (await page.getByTestId("engines-fit").count()) === 0 && (await page.getByTestId("engines-fit-empty").count()) === 0 && (await page.locator("#suggest-engines").count()) === 0);
      check("y1", `${label}: no bridges or engines request is made`, bridgeCalls.lists.length === 0 && engineCalls.length === 0 && bridgeCalls.starts.length === 0 && bridgeCalls.archetypes === 0, { lists: bridgeCalls.lists.length, engines: engineCalls.length });
      if (!genesysOn) await shot(`domain-no-bridges-${viewport.name}`);
    }
  }
  control.mode = "normal"; control.genesys = false;
  await page.setViewportSize({ width: 1920, height: 1080 });
  // Switching to a Domain format while Bridges is open falls back to Cards; no bridges request follows.
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  engineCalls.length = 0; bridgeCalls.lists.length = 0;
  await page.getByRole("button", { name: "Domain", exact: true }).first().click();
  await page.waitForTimeout(1200);
  check("y2", "switching to Domain removes the Bridges tab and shows Cards", (await page.getByRole("tab", { name: "Bridges", exact: true }).count()) === 0 && (await page.getByRole("tab", { name: "Cards", exact: true }).first().getAttribute("aria-selected")) === "true", await page.getByRole("tab").allInnerTexts());
  check("y2", "no bridges request follows the switch", engineCalls.length === 0 && bridgeCalls.lists.length === 0, { engines: engineCalls.length, lists: bridgeCalls.lists.length });
  await page.getByRole("button", { name: "Standard", exact: true }).first().click();
  await page.waitForTimeout(600);
  check("y2", "switching back to Standard brings the Bridges tab back", (await page.getByRole("tab", { name: "Bridges", exact: true }).count()) >= 1);
  engineControl.mode = "single";

  // x. Saved chip edits, Pick archetypes, and the details of a link.
  engineControl.mode = "single"; engineControl.status = 200; engineControl.nextEmpty = false;
  Object.assign(bridgeControl, { startRetryAfter: 0, jobMode: "ok", deepNone: false, pollDelayMs: 0 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fresh();
  await goTab("Bridges");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  const modes = bridges.getByTestId("engine-modes");
  check("x1", "two ways to choose the engines show, and the deck's own is on", (await modes.getByRole("button").allInnerTexts()).join("|") === "Use my deck|Pick archetypes" && (await modes.getByRole("button", { name: "Use my deck" }).getAttribute("aria-pressed")) === "true");
  await chips.getByRole("button", { name: /^Add Dragunity/ }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  const storedKey = await page.evaluate(() => { try { return Object.keys(localStorage).filter((key) => key.startsWith("bridges:engines:")); } catch { return []; } });
  const stored = storedKey.length === 1 ? await page.evaluate((key: string) => localStorage.getItem(key), storedKey[0]) : null;
  check("x1", "an edit is kept for the deck in this browser", stored != null && JSON.parse(stored).added?.[0] === "Dragunity", { storedKey, stored });
  await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
  await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(400);
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  check("x2", "after a reload the chips are the edited set", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes", "Dragunity"]) && (await chips.getByTestId("engine-reset").count()) === 1, await chipNames());

  // The edits are for Bridges only: the Suggest row still reads the deck's own engines.
  await goTab("Suggest");
  await fit.getByTestId("engine-fit-item").first().waitFor({ state: "visible", timeout: 15_000 });
  check("x2", "the Suggest row ignores the chip edits", (await fit.getByTestId("engine-fit-links").first().innerText()) === "Links Blue-Eyes");
  await goTab("Bridges");
  await chips.getByTestId("engine-reset").click();
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  const afterReset = await page.evaluate(() => { try { return Object.keys(localStorage).filter((key) => key.startsWith("bridges:engines:")); } catch { return ["error"]; } });
  check("x2", "Reset to deck clears the kept edits", afterReset.length === 0 && JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes"]), afterReset);

  // A broken or unreadable kept value is ignored.
  await page.evaluate(() => { try { localStorage.setItem("bridges:engines:1", "{not json"); } catch { /* No storage. */ } });
  await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
  await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(400);
  await goTab("Bridges");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("x2", "a broken kept value is ignored", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes"]), await chipNames());

  // Pick archetypes: one to four names, no deck.
  await modes.getByRole("button", { name: "Pick archetypes" }).click();
  await bridges.getByTestId("bridges-empty").waitFor();
  check("x3", "Pick archetypes starts with nothing picked, said once", (await chips.getByTestId("engine-chip").count()) === 0 && (await chips.getByTestId("engine-none").count()) === 0 && (await bridges.getByTestId("bridges-empty").innerText()).includes("Pick one to four"), await bridges.getByTestId("bridges-empty").innerText());
  const pickAdd = async (name: string) => {
    await chips.getByTestId("engine-add").click();
    const form = bridges.getByTestId("engine-add-form");
    await form.getByRole("combobox").fill(name);
    await form.getByRole("button", { name: "Add", exact: true }).click();
  };
  engineCalls.length = 0;
  await pickAdd("Blue-Eyes");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("x3", "one pick shows that archetype's own bridges, without saying your deck", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes"]) && (await bridges.getByRole("list", { name: "Blue-Eyes can bridge into", exact: true }).count()) === 1 && !(await bridges.innerText()).includes("Your Blue-Eyes deck"));
  await pickAdd("Chaos");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  check("x3", "two picks ask the host by name, with the open deck as context", engineCalls.length === 1 && JSON.stringify(engineCalls[0]!.engines) === JSON.stringify(["Blue-Eyes", "Chaos"]) && engineCalls[0]!.deck !== undefined, engineCalls);
  check("x3", "two picks show the bridge between them", JSON.stringify(await bridges.getByTestId("engines-between").getByTestId("bridge-item").locator("strong").allInnerTexts()) === JSON.stringify(["Blue-Eyes → Chaos"]) && (await bridges.getByTestId("engines-between").locator("h4").innerText()) === "Bridges between these archetypes", await bridges.getByTestId("engines-between").getByTestId("bridge-item").locator("strong").allInnerTexts());
  check("x3", "two picks show the next engine for them", (await bridges.getByTestId("engines-next").locator("h4").innerText()) === "Next engine for Blue-Eyes + Chaos");
  check("x3", "two picks hide the two-archetype search, which would say the same", (await bridges.getByTestId("bridge-search-toggle").count()) === 0);
  check("x3", "the picks have no reset link and no Also in deck", (await chips.getByTestId("engine-reset").count()) === 0 && (await chips.getByTestId("engine-also").count()) === 0);
  await pickAdd("Dragunity");
  await pickAdd("Dark Magician");
  await page.waitForTimeout(300);
  check("x3", "four picks are the most", (await chips.getByTestId("engine-chip").count()) === 4 && (await chips.getByTestId("engine-add").count()) === 0);
  await chips.getByRole("button", { name: "Remove Dark Magician" }).click();
  await chips.getByRole("button", { name: "Remove Dragunity" }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  // The deep search on picks sends the names alone.
  bridgeCalls.starts.length = 0;
  await bridges.getByTestId("deep-search-button").click();
  await bridges.getByTestId("deep-results").waitFor({ timeout: 20_000 });
  check("x3", "the deep search on picks sends the names, with the open deck as context", bridgeCalls.starts.length === 1 && JSON.stringify(bridgeCalls.starts[0]!.engines) === JSON.stringify(["Blue-Eyes", "Chaos"]) && bridgeCalls.starts[0]!.deck !== undefined, bridgeCalls.starts);
  const pickResults = bridges.getByTestId("deep-results").getByTestId("engine-item");
  check("x3", "the deep search on picks shows engine cards for the set of both picks", (await pickResults.count()) >= 1 && /^Links [12] of 2$/.test(await pickResults.first().getByTestId("engine-covered").innerText()) && (await bridges.getByTestId("deep-results").locator("h4").innerText()) === "Next engine for Blue-Eyes + Chaos" && (await bridges.getByTestId("deep-none").count()) === 0 && (await bridges.getByTestId("deep-results").getByTestId("bridge-item").count()) === 0, await pickResults.locator("strong").allInnerTexts());
  await shot("pick-1920x1080");
  await modes.getByRole("button", { name: "Use my deck" }).click();
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("x3", "Use my deck brings the deck's engines back", JSON.stringify(await chipNames()) === JSON.stringify(["Blue-Eyes"]));

  // Pick archetypes needs no cards, so an empty deck can use it.
  await fresh("empty");
  await goTab("Bridges");
  await bridges.getByTestId("engine-modes").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  check("x4", "an empty deck still offers the picker", (await bridges.getByTestId("bridges-empty").innerText()).includes("Add a few Main Deck cards"));
  check("x4", "an empty deck asks for no engines and no bridges", engineCalls.length === 0 && bridgeCalls.lists.length === 0, { engines: engineCalls.length, lists: bridgeCalls.lists });
  // A kept chip edit that adds an engine: the empty deck still says only to add cards, with no "Your ... deck" line.
  await page.evaluate(() => { try { localStorage.setItem("bridges:engines:1", JSON.stringify({ added: ["Blue-Eyes"], removed: [] })); } catch { /* No storage. */ } });
  await page.goto(`${ORIGIN}/index.html?deck=1&flag=on`);
  await page.getByRole("tab", { name: "Cards", exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(400);
  await goTab("Bridges");
  await bridges.getByTestId("bridges-empty").waitFor({ timeout: 15_000 });
  check("x4", "an empty deck with a kept added engine shows no lead line above the hint", (await bridges.getByTestId("bridges-empty").innerText()).includes("Add a few Main Deck cards") && (await bridges.locator("p", { hasText: "can bridge into" }).count()) === 0);
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* No storage. */ } });
  await bridges.getByTestId("engine-modes").getByRole("button", { name: "Pick archetypes" }).click();
  await pickAdd("Blue-Eyes");
  await items.first().waitFor({ state: "visible", timeout: 15_000 });
  check("x4", "a pick on an empty deck shows bridges, without saying your deck", (await items.count()) > 0 && (await bridges.locator("p", { hasText: "can bridge into" }).first().innerText()) === "Blue-Eyes can bridge into");

  // Each link opens the details of its bridge, and Back returns to the list.
  engineControl.mode = "multi";
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  // The second link of the first engine (Dragunity → Chaos), opened from a scrolled list.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);
  const link = bridges.getByTestId("engines-next").getByTestId("engine-item").first().getByTestId("engine-link").nth(1);
  await link.scrollIntoViewIfNeeded();
  const linkHash = await link.getAttribute("data-bridge");
  const paneScroll = () => page.locator('[data-pane="bridges"] > div').evaluate((node: HTMLElement) => node.scrollTop);
  await page.locator('[data-pane="bridges"] > div').evaluate((node: HTMLElement) => { node.scrollTop += 40; });
  const scrolled = await paneScroll();
  await link.click();
  await bridges.getByTestId("bridge-details").waitFor({ timeout: 10_000 });
  const crumbs = (await bridges.getByTestId("bridge-drill").getByRole("navigation", { name: "Where you are" }).locator("li").allInnerTexts()).map((text: string) => text.trim());
  check("x5", "a link opens the details of its own bridge", JSON.stringify(crumbs) === JSON.stringify(["Dragunity", "Chaos"]) && (await bridges.getByTestId("bridge-line").innerText()).includes("Dragunity Dux") && linkHash === hashOf("Dragunity>Chaos"), { crumbs, linkHash });
  await shot("engine-link-details-1366x768");
  await bridges.getByTestId("bridge-drill").getByRole("button", { name: /Back/ }).click();
  await bridges.getByTestId("engines-next").waitFor({ timeout: 10_000 });
  check("x5", "Back puts the focus on the same link", await page.evaluate((hash: string | null) => { const node = document.activeElement as HTMLElement | null; return node?.dataset?.testid === "engine-link" && node.dataset.bridge === hash && !!node.closest('[data-testid="engines-next"]'); }, linkHash));
  check("x5", "Back puts the list where it was", Math.abs((await paneScroll()) - scrolled) <= 2 && scrolled > 0, { scrolled, after: await paneScroll() });
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Genesys: the engine shows the points its missing cards cost.
  control.genesys = true;
  await fresh();
  await goTab("Bridges");
  await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
  check("x6", "a Genesys deck shows the points an engine needs", (await bridges.getByTestId("engines-next").getByRole("list", { name: "Warnings" }).first().innerText()).includes("Genesys points"));
  check("x6", "the host was asked for Genesys", engineCalls.every((call) => call.format === "genesys"), engineCalls.map((call) => call.format));
  control.genesys = false;
  engineControl.mode = "single";

  // x7. Pick mode and link details at every viewport.
  engineControl.mode = "multi";
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fresh();
    await goTab("Bridges");
    await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
    await modes.getByRole("button", { name: "Pick archetypes" }).click();
    for (const name of ["Blue-Eyes", "Chaos", "Dragunity"]) await pickAdd(name);
    await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await bridges.scrollIntoViewIfNeeded();
    check("x7", `${viewport.name}: pick mode does not scroll the page sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check("x7", `${viewport.name}: the mode switch, chips and cards stay inside the column`, await bridges.evaluate((root: HTMLElement) => { const edge = root.getBoundingClientRect().right + 1; return [...root.querySelectorAll('[data-testid="engine-modes"], [data-testid="engine-chip"], [data-testid="engine-item"]')].every((node) => node.getBoundingClientRect().right <= edge); }));
    await shot(`pick-${viewport.name}`);
    await bridges.getByTestId("engines-next").getByTestId("engine-link").first().click();
    await bridges.getByTestId("bridge-details").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    check("x7", `${viewport.name}: link details do not scroll the page sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(`engine-link-details-${viewport.name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  engineControl.mode = "single";

  // z. The views for review at every size: deck engines, picks, link details, deep search done, and Suggest.
  engineControl.mode = "multi";
  Object.assign(bridgeControl, { startRetryAfter: 0, jobMode: "ok", deepNone: false, pollDelayMs: 0 });
  const paneTop = (pane: string) => page.locator(`[data-pane="${pane}"] > div`).evaluate((node: HTMLElement) => { node.scrollTop = 0; });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await fresh();
    await goTab("Bridges");
    await bridges.getByTestId("engines-next").getByTestId("engine-item").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await paneTop("bridges");
    await shot(`z-bridges-deck-${viewport.name}`);
    const nextTop = await bridges.getByTestId("engines-next").evaluate((node: HTMLElement) => node.getBoundingClientRect().top);
    check("z", `${viewport.name}: the next engine list starts on the first screen`, nextTop < viewport.height - 120, nextTop);
    if (viewport.width < 960) {
      const targets = await bridges.evaluate((root: HTMLElement) => [...root.querySelectorAll('[data-testid="engine-chip"] button, [data-testid="engine-add"], [data-testid="engine-modes"] button, [data-testid="engine-also"] button')].map((node) => { const box = node.getBoundingClientRect(); return [node.getAttribute("aria-label") ?? node.textContent?.trim(), Math.round(box.width), Math.round(box.height)]; }));
      check("z", "phone touch targets are at least 40px tall and wide", targets.length > 0 && targets.every(([, width, height]) => Number(width) >= 40 && Number(height) >= 40), targets);
    }
    await bridges.getByTestId("engines-next").getByTestId("engine-link").first().click();
    await bridges.getByTestId("bridge-details").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await shot(`z-bridges-details-${viewport.name}`);
    await bridges.getByRole("button", { name: /^Back/ }).click();
    await bridges.getByTestId("deep-search-button").click();
    await bridges.getByTestId("deep-results").getByTestId("engine-item").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    await paneTop("bridges");
    await shot(`z-bridges-deep-${viewport.name}`);
    await modes.getByRole("button", { name: "Pick archetypes" }).click();
    for (const name of ["Blue-Eyes", "Chaos"]) await pickAdd(name);
    await bridges.getByTestId("engines-next").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await paneTop("bridges");
    await shot(`z-bridges-pick-${viewport.name}`);
    await goTab("Suggest");
    await fit.getByTestId("engine-fit-item").first().waitFor({ state: "visible", timeout: 15_000 });
    await panel.locator('section[aria-labelledby="suggest-archetype"] li > button').first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(400);
    await shot(`z-suggest-${viewport.name}`);
    if (viewport.width < 960) {
      check("z", "the phone panels are named by the phone tabs", await page.evaluate(() => [...document.querySelectorAll('[role="tabpanel"]')].every((pane) => { const tab = document.getElementById(pane.getAttribute("aria-labelledby") ?? ""); return tab?.getAttribute("role") === "tab" && tab.closest('[data-testid="editor-tabs-seg"]') != null; })));
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  engineControl.mode = "single";

  check("all", "no browser errors", pageErrors.length === 0, pageErrors);
  check("all", "every API call the editor made is mirrored", unrouted.length === 0, [...new Set(unrouted)]);
} catch (error) {
  console.error(error);
  check("harness", browser ? "browser scenario completed" : "Chromium launched", false, error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await browser?.close();
  cardDb.close();
}
await writeFile(resolve(out, "evidence.json"), JSON.stringify({ checks, screenshots: shots }, null, 2));
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed. Screenshots: ${out}`);
process.exit(exitCode || (failed.length > 0 ? 1 : 0));
