import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedDraftDeck } from "./helpers/draft-deck-fixture";
import { fixtureUserId, fixtureDiscordId } from "./fixtures/identity";
const { auth, callDuelHost } = vi.hoisted(() => ({ auth: vi.fn(), callDuelHost: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));
const dirs: string[] = [];
beforeEach(() => { vi.resetModules(); auth.mockResolvedValue({ user: { id: String(fixtureUserId("drafter")), discordUserId: fixtureDiscordId("drafter"), name: "Yugi" } }); });
afterEach(() => { delete process.env.DATABASE_PATH; delete process.env.DISCORD_GUILD_ID; for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }); });

it.each([[10, 11], [11, 10], [11, 12]])("preserves chosen art %s → %s through draft save/read and export while checking canonical pool", async (drafted, chosen) => {
  const { dir, draftId } = await seedDraftDeck({ picks: [drafted] }); dirs.push(dir);
  const engine = join(dir, "engine"); mkdirSync(engine);
  const cdb = new Database(join(engine, "cards.cdb"));
  cdb.exec(`create table datas (id integer primary key, ot integer, alias integer, type integer);
    create table texts (id integer primary key, name text);
    insert into datas values (10,3,0,17),(11,3,10,17),(12,3,11,17),(20,3,0,17);
    insert into texts values (10,'Dragon'),(11,'Dragon'),(12,'Dragon'),(20,'Other');`); cdb.close();
  const { normalizeCardCodes } = await import("../../duel-server/src/deck-import");
  const db = new Database(process.env.DATABASE_PATH!);
  callDuelHost.mockImplementation(async (input: { codes: number[]; preserveArtwork?: boolean }) => ({
    ok: true, data: { codes: Object.fromEntries(await normalizeCardCodes(input.codes, engine, db, { preserveArtwork: input.preserveArtwork })) },
  }));
  try {
    const deck = { main: [chosen], extra: [], side: [] };
    const { POST } = await import("../app/api/decks/route");
    const response = await POST(new Request("http://localhost/api/decks", { method: "POST", body: JSON.stringify({ name: "Art", mode: "normal", draftId, deck }) }));
    expect(response.status).toBe(201);
    const saved = (await response.json()).deck;
    expect(saved.deck).toEqual(deck);
    const { GET, PUT } = await import("../app/api/decks/[id]/route");
    const params = { params: Promise.resolve({ id: String(saved.id) }) };
    expect((await (await GET(new Request("http://localhost"), params)).json()).deck.deck).toEqual(deck);
    const { deckYdkText } = await import("../src/components/decks/model");
    expect(deckYdkText(deck)).toContain(`\n${chosen}\n`);
    const invalid = await PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "Art", mode: "normal", deck: { ...deck, main: [20] } }) }), params);
    expect(invalid.status).toBe(400);
    const tooMany = await PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "Art", mode: "normal", deck: { ...deck, main: [10, 11] } }) }), params);
    expect(tooMany.status).toBe(400);
  } finally { db.close(); }
});

it("round-trips selected artwork in regular saved decks", async () => {
  const { dir } = await seedDraftDeck({ picks: [] }); dirs.push(dir);
  const deck = { main: [11,10], extra: [21], side: [12] };
  const { POST } = await import("../app/api/decks/route");
  const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ name: "Art", mode: "normal", deck }) }));
  expect(response.status).toBe(201);
  const saved = (await response.json()).deck;
  const { GET } = await import("../app/api/decks/[id]/route");
  const read = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: String(saved.id) }) });
  expect((await read.json()).deck.deck).toEqual(deck);
});
