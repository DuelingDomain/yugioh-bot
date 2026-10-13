/**
 * Real engine verification. Run the web test wrapper with Node 22 and prlimit --core=0:
 * DECK_IMPORT_VERIFY=1 DUEL_DATA_DIR=/path/to/engine-prerelease npm exec --workspace=@yugioh-discord-bot/web --
 *   vitest run tests/deck-import-engine.test.ts --maxWorkers=1
 * Only authentication, the application DB boundary, and HTTP transport are replaced.
 * Transport calls the real signed duel host. All card lookups and writes are real.
 */
import Database from "better-sqlite3";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { defaultDuelSettings, type DuelDeck, type DuelMode } from "@yugidraft/shared/duels";
import { encodeYdke } from "@yugidraft/shared/decks";
import { createDeckTypeLookup, createDuelService, createSavedDeckService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../packages/duel-server/src/host.js";
import { validateExtraDeckTypes } from "../packages/duel-server/src/deck-legality.js";
import { seedIdentity } from "../packages/duel-server/tests/helpers/identity.js";

const boundary = vi.hoisted(() => ({ db: undefined as unknown as Database.Database,
  actor: undefined as unknown as Record<string, unknown>, playerId: 0, guildId: "", host: undefined as unknown as DuelHost }));
vi.mock("@/lib/db", () => ({ getDb: () => boundary.db }));
vi.mock("@/lib/saved-decks", async original => ({
  ...await original<typeof import("../packages/web/src/lib/saved-decks")>(), requireSavedDeckActor: async () => boundary.actor,
}));
vi.mock("@/lib/duel-host", () => ({
  requireDuelActor: async () => ({ ok: true, guildId: boundary.guildId, playerId: boundary.playerId }),
  callDuelHost: async (body: Record<string, unknown>) => {
    const response = await hostPost(body);
    return response.ok ? { ok: true, data: await response.json() } : { ok: false, response };
  },
}));
import { POST as importDeck } from "../packages/web/app/api/decks/import/route";
import { POST as preview } from "../packages/web/app/api/decks/import/preview/route";
import { POST as bulk } from "../packages/web/app/api/decks/import/bulk/route";
import { POST as createDeck } from "../packages/web/app/api/decks/route";
import { PUT as updateDeck } from "../packages/web/app/api/decks/[id]/route";
import { fixMisplaced, placementBlock, type CardCatalog } from "../packages/web/src/components/decks/model";

type EngineCard = { id: number; alias: number; type: number; name: string; level: number; atk: number; def: number; attribute: number; race: number; desc: string };
type Fixture = { name: string; mode: DuelMode; deck: DuelDeck; bad?: number; misplaced?: true; overflow?: true; unknown?: true };
const dataDirectory = process.env.DUEL_DATA_DIR;
const secret = "verify-deck-import-only";
const paths = ["YDK", "YDKE", "names", "passcodes", "bulk preview", "bulk YDKE", "bulk save", "save", "PUT", "editor", "validateExtraDeckTypes", "Ready"] as const;
type Path = typeof paths[number];
const results: Array<{ cache: string; deck: string; path: Path; result: "PASS" | "FAIL" }> = [];
let engine: Map<number, EngineCard>;
let fixtures: Fixture[];
let directory: string;
let serial = 0;
let decks: ReturnType<typeof createSavedDeckService>;
let engineHash: string;
const fixtureCount = 10;
const knownType = (type: number) => (type & (1 | 2 | 4 | 0x8000000)) !== 0;
const sections = ["main", "extra", "side"] as const;
// Independent numeric expectation. Do not derive expected sections from the lookup under test.
const extraType = (type: number) => (type & 1) !== 0 && (type & (0x40 | 0x2000 | 0x800000 | 0x4000000)) !== 0;
const copies = (entries: Array<[number, number]>) => entries.flatMap(([code, count]) => Array<number>(count).fill(code));
const blueMain = copies([[89631139, 3], [38517737, 2], [30576089, 2], [8240199, 3], [71039903, 3], [79814787, 1],
  [66961194, 2], [64202399, 1], [55410871, 1], [14558127, 3], [97268402, 2], [48800175, 3], [38120068, 3],
  [41620959, 2], [71143015, 2], [6853254, 2], [21082832, 1], [62089826, 2], [93437091, 2]]);
const mixedExtra = [12381100, 43321985, 1546124, 100459004, 101402084, 23995346, 70902743, 63767246, 1861629,
  13331639, 90036274, 45627618, 59822133, 2129638, 11443677];
const blueExtra = [12381100, 23995346, 2129638, 11443677, 43228023, 56532353, 59822133, 89604813, 43321985,
  63767246, 1861629, 1546124, 100459004, 101402090, 71808988];
const scanExtra = [100458022, 100458023, 100459004, 100459009, 101402084, 101402086, 101402087, 101402090, 101402091, 71808988];
const side = copies([[14558127, 3], [97268402, 3], [55144522, 1], [12580477, 1], [44095762, 2], [82732705, 2], [24224830, 3]]);

beforeAll(() => {
  if (!dataDirectory) throw new Error("Set DUEL_DATA_DIR to the real released + pre-release bundle.");
  const file = join(dataDirectory, "cards.cdb");
  engineHash = createHash("sha256").update(readFileSync(file)).digest("hex");
  const cdb = new Database(file, { readonly: true, fileMustExist: true });
  try {
    engine = new Map((cdb.prepare("select d.*, t.name, t.desc from datas d join texts t using(id)").all() as EngineCard[]).map(card => [card.id, card]));
  } finally { cdb.close(); }
  const dragons = [38517737, 30576089, 64202399, 55410871, 20654247, 54475145, 57043986, 8240199, 71039903, 79814787,
    66961194, 14558127, 97268402, 3078380, 2333466, 6637331, 5560911, 7987191, 4810828, 6283472,
    7127502, 7305060, 291414, 545781, 564541, 876330, 3954901, 4991081, 6556909, 6930746];
  const spells = [48800175, 38120068, 41620959, 71143015, 6853254, 21082832, 62089826, 93437091, 55144522,
    12580477, 44095762, 82732705, 24224830, 59080, 269012];
  const pendulumMain = copies([[16178681, 3], [14105623, 3], [47075569, 3], [92746535, 3], [75195825, 2],
    [69512157, 2], [55410871, 2], [66425726, 2], [53208660, 3], [46052429, 3], [21082832, 3],
    [65646587, 2], [42378577, 2], [1344018, 2], [74850403, 2], [55144522, 1], [44095762, 2]]);
  const misplaced: DuelDeck = { main: [...blueMain, 12381100], extra: [...blueExtra.filter(code => code !== 12381100), 55144522], side };
  fixtures = [
    { name: "Domain dragons", mode: "domain", deck: { main: [...dragons, ...spells], extra: mixedExtra,
      side: [30397786, 15693423, 59438930, 94145021, 73642296, 23434538, 27204311, 18144506, 23002292], deckMaster: 89631139 } },
    { name: "Blue-Eyes", mode: "normal", deck: { main: blueMain, extra: blueExtra, side } },
    { name: "Pendulums and Rituals", mode: "normal", deck: { main: pendulumMain, extra: mixedExtra, side } },
    { name: "Spell in Extra", mode: "normal", bad: 55144522, deck: { main: blueMain, extra: [...blueExtra.slice(0, 14), 55144522], side: [] } },
    { name: "Ten scan cards", mode: "normal", deck: { main: blueMain, extra: scanExtra, side } },
    { name: "Misplaced cards", mode: "normal", misplaced: true, deck: misplaced },
    { name: "Extra monsters in Main", mode: "normal", deck: { main: [...blueMain, ...mixedExtra], extra: [], side: [] } },
    { name: "Extra overflow", mode: "normal", overflow: true, deck: { main: [...blueMain, 12381100], extra: mixedExtra, side: [] } },
    { name: "Explicit Side Extra monsters", mode: "normal", deck: { main: blueMain, extra: mixedExtra.slice(0, 12), side: [12381100, 43321985, 1861629] } },
    { name: "Unknown engine types", mode: "normal", unknown: true, deck: { main: [...blueMain, 9995767], extra: [...mixedExtra.slice(0, 14), 10000120], side: [10000110] } },
  ];
  for (const fixture of fixtures) {
    for (const code of [...fixture.deck.main, ...fixture.deck.extra, ...fixture.deck.side, ...(fixture.deck.deckMaster ? [fixture.deck.deckMaster] : [])]) {
      expect(engine.has(code), `Real engine card ${code}`).toBe(true);
    }
    expect(fixture.deck.main.length).toBeGreaterThanOrEqual(40);
    expect(fixture.deck.main.length).toBeLessThanOrEqual(fixture.overflow ? 61 : 60);
    expect(fixture.deck.extra.length).toBeLessThanOrEqual(15);
  }
  expect(fixtures[0].deck.main.length + fixtures[0].deck.extra.length + fixtures[0].deck.side.length + 1).toBe(70);
  const domainCodes = [...fixtures[0].deck.main, ...fixtures[0].deck.extra, ...fixtures[0].deck.side, fixtures[0].deck.deckMaster!];
  expect(new Set(domainCodes.map(code => engine.get(code)!.alias || code)).size).toBe(70);
  for (const bit of [0x40, 0x2000, 0x800000]) expect(mixedExtra.some(code => (engine.get(code)!.type & (bit | 0x1000000)) === (bit | 0x1000000))).toBe(true);
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "verify-deck-import-"));
  boundary.db = openDatabase(join(directory, "verify.sqlite"));
  boundary.guildId = `verify-${++serial}`;
  const identity = seedIdentity(boundary.db, { guildId: boundary.guildId, discordUserId: "900000000000000001" });
  boundary.playerId = identity.playerId;
  decks = createSavedDeckService(boundary.db);
  boundary.actor = { ok: true, guildId: boundary.guildId, ownerUserId: identity.userId, discordUserId: identity.discordUserId, decks };
  boundary.host = createDuelHost({ db: boundary.db, dataDirectory: dataDirectory!, secret, searchCards: () => [], pollIntervalMs: 60_000,
    createWorker: () => { throw new Error("This verification does not start a duel engine."); } });
  vi.stubGlobal("fetch", () => { throw new Error("Unexpected network card lookup"); });
});
afterEach(async () => {
  await boundary.host?.close();
  boundary.db?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => {
  expect(createHash("sha256").update(readFileSync(join(dataDirectory!, "cards.cdb"))).digest("hex")).toBe(engineHash);
  if (process.env.DECK_IMPORT_VERIFY_JSON) writeFileSync(process.env.DECK_IMPORT_VERIFY_JSON, JSON.stringify({ engineHash, results }, null, 2));
});

async function hostPost(body: Record<string, unknown>) {
  const raw = JSON.stringify({ guildId: boundary.guildId, playerId: boundary.playerId, ...body });
  return boundary.host.handle(new Request("http://verify/internal/duel", { method: "POST", body: raw,
    headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
}
const request = (body: unknown, method = "POST") => new Request("http://verify/api/decks", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
function textFor(deck: DuelDeck, kind: "YDK" | "names" | "passcodes") {
  const marker = (section: typeof sections[number]) => kind === "YDK" ? { main: "#main", extra: "#extra", side: "!side" }[section] : `${section} Deck:`;
  const label = (code: number) => kind === "names" ? `${engine.get(code)!.name} x1` : String(code);
  return [...(deck.deckMaster ? ["#deckmaster", label(deck.deckMaster)] : []), ...sections.flatMap(section => [marker(section), ...deck[section].map(label)])].join("\n");
}
function expected(fixture: Fixture, names = false, ydke = false, route = false): DuelDeck {
  const map = (code: number) => {
    const card = engine.get(code)!;
    return names && card.alias && engine.get(card.alias)?.name === card.name ? card.alias : code;
  };
  const raw = fixture.deck;
  const deck: DuelDeck = { main: raw.main.map(map), extra: raw.extra.map(map), side: raw.side.map(map) };
  if (raw.deckMaster && !ydke) deck.deckMaster = map(raw.deckMaster);
  if (!route) return deck;
  return { ...deck,
    main: [...deck.main.filter(code => !knownType(engine.get(code)!.type) || !extraType(engine.get(code)!.type)), ...deck.extra.filter(code => knownType(engine.get(code)!.type) && !extraType(engine.get(code)!.type))],
    extra: [...deck.main.filter(code => knownType(engine.get(code)!.type) && extraType(engine.get(code)!.type)), ...deck.extra.filter(code => !knownType(engine.get(code)!.type) || extraType(engine.get(code)!.type))] };
}
function assertDeck(actual: DuelDeck, wanted: DuelDeck) {
  for (const section of sections) expect(actual[section], section).toEqual(wanted[section]);
  expect(actual.deckMaster ?? undefined).toEqual(wanted.deckMaster);
}
function seedStaleCatalog() {
  const insert = boundary.db.prepare("insert or ignore into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'effect','','','[]','verify')");
  const used = new Set(fixtures.flatMap(({ deck }) => [...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster ? [deck.deckMaster] : [])]));
  boundary.db.transaction(() => { for (const code of used) {
    const card = engine.get(code)!;
    if (card.id === 12381100 || scanExtra.includes(card.id)) continue;
    insert.run(card.id, card.name, extraType(card.type) ? "Effect Monster" : (card.type & 2) ? "Spell Card" : (card.type & 4) ? "Trap Card" : "Effect Monster");
  } })();
}

describe.each(["empty", "stale"])("real engine deck imports: %s catalog", cache => {
  for (let index = 0; index < fixtureCount; index++) {
    describe(`deck ${index + 1}`, () => {
      it.each(paths)("%s", async path => {
        const fixture = fixtures[index];
        const result = { cache, deck: fixture.name, path, result: "FAIL" as "PASS" | "FAIL" };
        results.push(result);
        if (cache === "stale") seedStaleCatalog();
        const invalid = fixture.deck.extra.filter(code => !extraType(engine.get(code)!.type));
        const moved = sections.slice(0, 2).flatMap(section => fixture.deck[section].filter(code => knownType(engine.get(code)!.type) && (extraType(engine.get(code)!.type) ? section === "main" : section === "extra")));
        const assertMessages = (messages: unknown) => {
          const text = JSON.stringify(messages);
          for (const code of moved) expect(text).toContain(engine.get(code)!.name);
          if (fixture.unknown) for (const code of [9995767, 10000120, 10000110]) expect(text).toContain(engine.get(code)!.name);
          if (fixture.overflow) expect(text).toMatch(/Extra.*15/);
        };
        if (path === "YDK" || path === "YDKE" || path === "names" || path === "passcodes") {
          const response = await importDeck(request({ mode: fixture.mode, text: path === "YDKE" ? encodeYdke(fixture.deck) : textFor(fixture.deck, path) }));
          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.mode).toBe(fixture.mode);
          assertDeck(body.deck, expected(fixture, path === "names", path === "YDKE", true));
          expect(body.moves).toHaveLength(moved.length);
          assertMessages(body.messages);
          for (const move of body.moves) expect(body.messages.join(" ")).toContain(engine.get(move.code)!.name);
        } else if (path === "bulk preview" || path === "bulk YDKE") {
          const isYdke = path === "bulk YDKE";
          const response = await preview(request({ sources: [{ id: "real", name: fixture.name, mode: fixture.mode === "domain" ? "domain" : "standard", text: isYdke ? encodeYdke(fixture.deck) : textFor(fixture.deck, "YDK") }] }));
          expect(response.status).toBe(200);
          const [row] = (await response.json()).rows;
          expect(row.errors).toEqual([]);
          const wanted = expected(fixture, false, isYdke, true);
          assertDeck(row.deck, wanted);
          assertMessages(row.warnings);
          for (const code of invalid) expect(JSON.stringify(row.warnings)).toContain(engine.get(code)!.name);
          const saved = await bulk(request({ rows: [row] }));
          expect(saved.status).toBe(fixture.unknown ? 400 : 200);
          const body = await saved.json();
          if (fixture.unknown) {
            expect(body.error).toContain(engine.get(10000120)!.name);
            result.result = "PASS";
            return;
          }
          expect(body.failed).toEqual([]);
          assertDeck(decks.get(body.created[0].id, boundary.guildId, boundary.actor.ownerUserId as number).deck, wanted);
        } else if (path === "bulk save" || path === "save" || path === "PUT") {
          const input = { name: fixture.name, mode: fixture.mode, deck: fixture.deck };
          let response: Response;
          if (path === "bulk save") response = await bulk(request({ rows: [{ ...input, mode: fixture.mode === "domain" ? "domain" : "standard" }] }));
          else if (path === "save") response = await createDeck(request(input));
          else {
            const stored = decks.create(boundary.guildId, boundary.actor.ownerUserId as number, { ...input, deck: { main: [], extra: [], side: [] } });
            response = await updateDeck(request(input, "PUT"), { params: Promise.resolve({ id: String(stored.id) }) });
          }
          const body = await response.json();
          if (invalid.length) {
            expect(response.status).toBe(400);
            expect(body.code).toBe("INVALID_EXTRA_DECK_CARD");
            expect(body.error).toContain(engine.get(invalid[0])!.name);
            const stored = boundary.db.prepare("select deck_json from saved_decks").all() as { deck_json: string }[];
            expect(stored.every(row => JSON.parse(row.deck_json).extra.length === 0)).toBe(true);
          } else {
            expect(response.status).toBe(path === "save" ? 201 : 200);
            if (path === "bulk save") {
              expect(body.failed).toEqual([]);
              assertDeck(decks.get(body.created[0].id, boundary.guildId, boundary.actor.ownerUserId as number).deck, expected(fixture, false, false, true));
              assertMessages(body.warnings);
            } else assertDeck(body.deck.deck, expected(fixture));
          }
        } else if (path === "editor") {
          const catalog = engine as unknown as CardCatalog;
          for (const section of sections) for (const code of fixture.deck[section]) {
            const card = engine.get(code)!;
            const misplaced = knownType(card.type) && section !== "side" && (extraType(card.type) ? section !== "extra" : section !== "main");
            const refusal = placementBlock(card, section, section);
            if (misplaced) expect(refusal).toContain(card.name);
            else expect(refusal).toBeNull();
            if (section === "extra" && extraType(card.type)) expect(placementBlock(card, "main", "extra")).toContain(card.name);
          }
          const repaired = fixMisplaced(fixMisplaced({ deck: fixture.deck, masterOrigin: null }, catalog, "extra"), catalog, "main");
          // Editor fixes append; compare multisets rather than import order.
          const wanted = expected(fixture, false, false, true);
          for (const section of sections) expect([...repaired.deck[section]].sort()).toEqual([...wanted[section]].sort());
        } else if (path === "validateExtraDeckTypes") {
          const run = () => validateExtraDeckTypes(fixture.deck, dataDirectory!, createDeckTypeLookup(boundary.db).snapshot());
          if (invalid.length) expect(run).toThrow(engine.get(invalid[0])!.name);
          else expect(run).not.toThrow();
        } else {
          const duels = createDuelService(boundary.db);
          const room = duels.create({ guildId: boundary.guildId, organizerPlayerId: boundary.playerId, name: fixture.name, mode: fixture.mode,
            settings: { ...defaultDuelSettings(fixture.mode), validateDeck: false, banlist: "none" } });
          // Store an old deck directly, so Ready must check it independently of submit.
          duels.setDeck(room.slug, boundary.guildId, boundary.playerId, fixture.deck);
          duels.markUnready(room.slug, boundary.guildId, boundary.playerId);
          const response = await hostPost({ op: "ready", slug: room.slug });
          const body = await response.json();
          expect(response.status).toBe(invalid.length ? 400 : 200);
          if (invalid.length) {
            expect(body.error).toContain(engine.get(invalid[0])!.name);
            expect(duels.get(room.slug, boundary.guildId).seats[0].ready).toBe(false);
          } else {
            expect(duels.get(room.slug, boundary.guildId).seats[0].ready).toBe(true);
            assertDeck(duels.room(room.slug, boundary.guildId, boundary.playerId).myDeck!, expected(fixture));
          }
        }
        if (cache === "empty") expect(boundary.db.prepare("select count(*) as n from card_catalog").get()).toEqual({ n: 0 });
        result.result = "PASS";
      });
    });
  }
});

describe("real import routes with a damaged remap file", () => {
  it.each(["missing", "invalid"])("keeps import, preview, bulk, save and PUT available: %s", async failure => {
    const broken = join(directory, "engine");
    // The real CDB stays read-only. Only the temporary remap metadata is damaged.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(broken);
    symlinkSync(join(dataDirectory!, "cards.cdb"), join(broken, "cards.cdb"));
    writeFileSync(join(broken, "manifest.json"), JSON.stringify({ sources: { databaseFormat: "official-releases-prerelease-v4" }, integrity: { cardRemaps: "expected" } }));
    if (failure === "invalid") writeFileSync(join(broken, "card-remaps.json"), "{}");
    vi.stubEnv("DUEL_DATA_DIR", broken);
    const fixture = fixtures[1];
    const imported = await importDeck(request({ mode: fixture.mode, text: textFor(fixture.deck, "YDK") }));
    expect(imported.status).toBe(200);
    assertDeck((await imported.json()).deck, fixture.deck);
    const shown = await preview(request({ sources: [{ id: "broken", name: fixture.name, text: textFor(fixture.deck, "YDK") }] }));
    expect(shown.status).toBe(200);
    const [row] = (await shown.json()).rows;
    expect(row.errors).toEqual([]);
    assertDeck(row.deck, fixture.deck);
    const saved = await bulk(request({ rows: [row] }));
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.failed).toEqual([]);
    assertDeck(decks.get(body.created[0].id, boundary.guildId, boundary.actor.ownerUserId as number).deck, fixture.deck);
    const created = await createDeck(request({ name: fixture.name, mode: fixture.mode, deck: fixture.deck }));
    expect(created.status).toBe(201);
    const id = (await created.json()).deck.id;
    const updated = await updateDeck(request({ name: fixture.name, mode: fixture.mode, deck: fixture.deck }, "PUT"), { params: Promise.resolve({ id: String(id) }) });
    expect(updated.status).toBe(200);
    assertDeck((await updated.json()).deck.deck, fixture.deck);
    expect(boundary.db.prepare("select count(*) as n from card_catalog").get()).toEqual({ n: 0 });
  });
});

// A list without Side markers cannot send any Extra monster to Side.
describe.each(["names", "passcodes"] as const)("bare %s list", kind => {
  it("puts every known Extra monster in Extra without a Side section", async () => {
    const text = [...blueMain, ...mixedExtra].map(code => kind === "names" ? `${engine.get(code)!.name} x1` : String(code)).join("\n");
    const response = await importDeck(request({ mode: "normal", text }));
    expect(response.status).toBe(200);
    assertDeck((await response.json()).deck, expected({ name: "bare", mode: "normal", deck: { main: [...blueMain, ...mixedExtra], extra: [], side: [] } }, kind === "names", false, true));
  });
});
