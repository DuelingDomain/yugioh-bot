import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ broadcaster, announcer: { announce: vi.fn() } }));

// One player may hold at most 3 copies of a card in a draft. The pick route refuses a fourth,
// bots only pick cards they may take, and the draft response marks capped cards and passed picks.

describe("per-player copy cap in the draft routes", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    broadcaster.draft.mockReset();
    auth.mockResolvedValue({ user: { id: "host", name: "Yugi" } });
    vi.stubEnv("DRAFT_TEST_BOTS", "1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setup(opts: { bots: number }) {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-copy-cap-"));
    const dbPath = join(tempDir, "bots.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
    const db = new Database(dbPath);
    migrate(db);
    const ins = db.prepare(
      "insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,?,?,?,?,?)",
    );
    const ids = Array.from({ length: 16 }, (_, i) => 500 + i);
    for (const id of ids) ins.run(id, `Card ${id}`, "Effect Monster", "effect", "i", "i", "[]", "t");
    const players = createPlayerService(db);
    const host = players.findOrCreate("guild-1", "host", "Yugi");
    const drafts = createDraftService(db);
    const draft = drafts.create(
      "guild-1", "channel-1", "cap night",
      { setNames: [], customCardIds: ids, cubeCardIds: ids, packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 },
      "host", host.id,
    );
    const others: number[] = [];
    if (opts.bots === 0) {
      others.push(players.findOrCreate("guild-1", "other", "Kaiba").id);
      drafts.join(draft.id, others[0]);
    } else {
      for (let i = 0; i < opts.bots; i += 1) {
        const bot = players.findOrCreate("guild-1", `bot_${i}`, `Bot ${i}`);
        drafts.join(draft.id, bot.id);
        others.push(bot.id);
      }
    }
    drafts.start(draft.id);
    return { db, drafts, draft, slug: draft.webSlug!, host: host.id, others };
  }

  let syntheticStep = -1;
  function grantCopies(db: import("better-sqlite3").Database, draftId: number, playerId: number, catalogCardId: number, copies: number) {
    const pack = db.prepare("select id, wave_number from draft_packs where draft_id = ? limit 1").get(draftId) as { id: number; wave_number: number };
    for (let i = 0; i < copies; i += 1) {
      const card = db
        .prepare(
          `insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position, picked_by_player_id, picked_at)
           values (?, ?, ?, ?, 99, ?, 't')`,
        )
        .run(draftId, pack.wave_number, pack.id, catalogCardId, playerId);
      db.prepare(
        `insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at)
         values (?, ?, ?, ?, ?, 'manual', 't')`,
      ).run(draftId, playerId, Number(card.lastInsertRowid), pack.wave_number, syntheticStep);
      syntheticStep -= 1;
    }
  }

  const pick = async (slug: string, cardId: number) => {
    const { POST } = await import("../app/api/drafts/[slug]/pick/route");
    return POST(
      new Request("http://localhost/pick", { method: "POST", body: JSON.stringify({ cardId }) }) as NextRequest,
      { params: Promise.resolve({ slug }) },
    );
  };

  it("answers a pick of a capped card with an error and picks nothing", async () => {
    const { db, drafts, draft, slug, host } = await setup({ bots: 0 });
    const capped = drafts.currentPackOptions(draft.id, host)[0];
    grantCopies(db, draft.id, host, capped.catalogCardId, 3);

    const res = await pick(slug, capped.id);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "You already have 3 copies of this card" });
    expect(db.prepare("select picked_by_player_id as p from draft_cards where id = ?").get(capped.id)).toEqual({ p: null });
    db.close();
  });

  it("marks capped cards in the draft response and keeps the turn while a card is allowed", async () => {
    const { db, drafts, draft, slug, host } = await setup({ bots: 0 });
    const pack = drafts.currentPackOptions(draft.id, host);
    grantCopies(db, draft.id, host, pack[0].catalogCardId, 3);
    grantCopies(db, draft.id, host, pack[1].catalogCardId, 2);

    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");
    const response = await buildDraftResponse(slug, "host");

    expect(response?.currentPack.map((card) => [card.id, card.held, card.blocked])).toEqual([
      [pack[0].id, 3, true],
      [pack[1].id, 2, false],
      [pack[2].id, 0, false],
      [pack[3].id, 0, false],
    ]);
    expect(response?.currentPack.every((card) => card.forced === false)).toBe(true);
    expect(response?.isMyTurn).toBe(true);
    expect(response?.passed).toBe(false);
    db.close();
  });

  it("allows a forced pick when the entire pack is capped", async () => {
    const { db, drafts, draft, slug, host, others } = await setup({ bots: 0 });
    const [other] = others;
    const hostPack = drafts.currentPackOptions(draft.id, host);
    const otherPack = drafts.currentPackOptions(draft.id, other);
    // Step 2 hands the host the rest of the other player's pack, and the host holds 3 of each card in it.
    for (const card of otherPack) grantCopies(db, draft.id, host, card.catalogCardId, 3);
    drafts.pickCard(draft.id, host, hostPack[0].id);
    drafts.pickCard(draft.id, other, otherPack[0].id);

    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");
    const response = await buildDraftResponse(slug, "host");

    expect(response?.pickStep).toBe(2);
    expect(response?.passed).toBe(false);
    expect(response?.isMyTurn).toBe(true);
    expect(response?.currentPack).toHaveLength(3);
    expect(response?.currentPack.every((card) => !card.blocked)).toBe(true);
    expect(response?.currentPack.every((card) => card.forced === true)).toBe(true);
    const seats = response?.seats ?? [];
    expect(seats.find((seat) => seat.playerId === host)?.hasPicked).toBe(false);
    expect(seats.find((seat) => seat.playerId === other)?.hasPicked).toBe(false);
    db.close();
  });

  it("keeps all legal choices visible in packs larger than eight", async () => {
    const { db, drafts, draft, slug, host } = await setup({ bots: 0 });
    const pack = db.prepare("select id from draft_packs where draft_id = ? and current_holder_seat_index = 0").get(draft.id) as { id: number };
    const ins = db.prepare("insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position) values (?, 1, ?, 500, ?)");
    for (let pos = 4; pos < 15; pos++) ins.run(draft.id, pack.id, pos);
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");
    const response = await buildDraftResponse(slug, "host");
    expect(response?.currentPack).toHaveLength(15);
    expect(new Set(response?.currentPack.map((card) => card.id)).size).toBe(15);
    expect(response?.currentPack.every((card) => !card.blocked)).toBe(true);
    db.close();
  });

  it("a bot never picks a capped card", async () => {
    const { db, drafts, draft, slug, host, others } = await setup({ bots: 1 });
    const [bot] = others;
    const botPack = drafts.currentPackOptions(draft.id, bot);
    const allowed = botPack[3];
    for (const card of botPack) {
      if (card.id !== allowed.id) grantCopies(db, draft.id, bot, card.catalogCardId, 3);
    }

    const res = await pick(slug, drafts.currentPackOptions(draft.id, host)[0].id);

    expect(res.status).toBe(200);
    const botPick = db
      .prepare("select draft_card_id as id from draft_picks where draft_id = ? and player_id = ? and pick_step = 1")
      .get(draft.id, bot) as { id: number };
    expect(botPick.id).toBe(allowed.id);
    db.close();
  });

  it.each(["expiry race", "bot failure", "bot options failure"])("keeps a saved human pick and broadcasts after %s", async (scenario) => {
    const { db, drafts, draft, slug, host, others } = await setup({ bots: 1 });
    const cardId = drafts.currentPackOptions(draft.id, host)[0].id;
    const shared = await import("@yugidraft/shared/services");
    const create = shared.createDraftService;
    let raced = false;
    vi.spyOn(shared, "createDraftService").mockImplementation((connection) => {
      const service = create(connection);
      return { ...service, pickOptions(...args: Parameters<typeof service.pickOptions>) {
        if (scenario === "bot options failure" && args[1] === others[0] && !raced) {
          raced = true;
          throw new Error("Bot options test failure");
        }
        return service.pickOptions(...args);
      }, pickCard(...args: Parameters<typeof service.pickCard>) {
        if (args[3] === "auto" && !raced) {
          raced = true;
          if (scenario === "bot failure") throw new Error("Bot test failure");
          connection.prepare("update drafts set pick_deadline_at = '2000-01-01' where id = ?").run(draft.id);
          service.expireCurrentPickStep(draft.id);
        }
        return service.pickCard(...args);
      } };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await pick(slug, cardId);
    expect(res.status).toBe(200);
    expect(raced).toBe(true);
    expect(db.prepare("select draft_card_id as id from draft_picks where draft_id = ? and player_id = ? and pick_step = 1").get(draft.id, host)).toEqual({ id: cardId });
    expect(broadcaster.draft).toHaveBeenCalledWith(expect.objectContaining({ kind: "pick", slug }));
    if (scenario === "expiry race") {
      expect(broadcaster.draft).toHaveBeenCalledWith(expect.objectContaining({ kind: "resync", slug, pickStep: 2 }));
      expect(db.prepare("select count(*) as n from draft_picks where draft_id = ? and player_id = ? and pick_step = 1").get(draft.id, others[0])).toEqual({ n: 1 });
    }
    db.close();
  });

  it("the draft keeps moving when a bot has nothing it may take", async () => {
    const { db, drafts, draft, slug, host, others } = await setup({ bots: 1 });
    const [bot] = others;
    // Step 2 gives the bot the rest of the host's pack, and the bot holds 3 of every card in it.
    for (const card of drafts.currentPackOptions(draft.id, host)) grantCopies(db, draft.id, bot, card.catalogCardId, 3);

    const first = await pick(slug, drafts.currentPackOptions(draft.id, host)[0].id);
    expect(first.status).toBe(200);
    expect(drafts.findById(draft.id).currentPickStep).toBe(2);
    expect(drafts.hasPassedStep(draft.id, bot)).toBe(false);

    // The bot passed step 2, so the host's pick closes it and the draft moves to step 3.
    const second = await pick(slug, drafts.pickOptions(draft.id, host)[0].id);
    expect(second.status).toBe(200);
    expect(drafts.findById(draft.id).currentPickStep).toBe(3);
    const botStep2 = db
      .prepare("select count(*) as n from draft_picks where draft_id = ? and player_id = ? and pick_step = 2")
      .get(draft.id, bot) as { n: number };
    expect(botStep2.n).toBe(1);
    db.close();
  });
});
