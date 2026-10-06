import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { parseSandboxBoard, type SandboxRun } from "../../src/duels/sandbox-board.js";
import { createDuelService, DuelServiceError, type DuelSetup } from "../../src/services/duels.js";
import { createLiveNowService } from "../../src/services/live-now.js";

const run: SandboxRun = { bots: { "1": "pass", "2": "practice", "3": "manual" }, seed: ["1", "2", "3", "4"] };
const sandboxSetup = (): DuelSetup => ({ sandbox: { board: parseSandboxBoard({ p0: { hand: [123] } }), run, scenarioId: 17 } });
const deck = { main: [123], extra: [], side: [] };
let db: Database.Database;
let duels: ReturnType<typeof createDuelService>;
let owner: number;
let viewer: number;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  const player = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)");
  owner = Number(player.run("owner", "Owner").lastInsertRowid);
  viewer = Number(player.run("viewer", "Viewer").lastInsertRowid);
  duels = createDuelService(db);
});
afterEach(() => db.close());

function create(extra: Partial<Parameters<typeof duels.create>[0]> = {}) {
  return duels.create({ guildId: "g", organizerPlayerId: owner, name: "Sandbox", mode: "normal", sandbox: true, ...extra });
}
function ready() {
  const duel = create({ settings: { validateDeck: false } });
  duels.setDeck(duel.slug, "g", owner, deck);
  duels.addPracticeBot(duel.slug, "g", owner, deck, 1);
  return duel;
}
function start() {
  const duel = ready();
  return duels.activate(duel.slug, "g", owner, run.seed!, "test", null, sandboxSetup());
}
function status(work: () => unknown, code: number) {
  expect(work).toThrowError(DuelServiceError);
  expect(work).toThrowError(expect.objectContaining({ status: code }));
}

describe("sandbox duel rows", () => {
  it("keeps engine setup when only the saved sandbox board is invalid", () => {
    const duel = create();
    const engineSetup = { startupScripts: ["return"], firstTurnDraw: true, engine: "pinned", surrenderedSeats: [1] };
    db.prepare("update duels set setup_json = ? where id = ?").run(JSON.stringify({
      ...engineSetup, sandbox: { board: { obsolete: true }, run },
    }), duel.id);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(duels.privateState(duel.slug, "g").setup).toEqual(engineSetup);
      expect(warning).toHaveBeenCalledWith("[duels] Ignoring invalid saved sandbox setup", expect.any(Error));
    } finally { warning.mockRestore(); }
  });
  it("adds an idempotent column with a non-sandbox default for existing rows", () => {
    const normal = create({ sandbox: false });
    const columns = db.prepare<[], { name: string }>("pragma table_info(duels)").all();
    if (columns.some((column) => column.name === "sandbox")) db.exec("alter table duels drop column sandbox");
    migrate(db);
    migrate(db);
    expect(db.prepare("select sandbox from duels where id = ?").get(normal.id)).toEqual({ sandbox: 0 });
    expect(duels.get(normal.slug, "g").sandbox).toBe(false);
  });

  it("forces private, untimed play and never creates an invite", () => {
    const duel = create({ settings: { visibility: "public", turnSeconds: 120 } });
    expect(duel).toMatchObject({ sandbox: true, ranked: false, bestOf: 1, seriesId: null, settings: { visibility: "private", turnSeconds: 0 } });
    expect(db.prepare("select sandbox, invite_code from duels where id = ?").get(duel.id)).toEqual({ sandbox: 1, invite_code: null });
    expect(duels.room(duel.slug, "g", owner).inviteCode).toBeUndefined();
  });

  it.each([{ ranked: true }, { bestOf: 3 as const }])("rejects match options %j without writing a row", (options) => {
    status(() => create(options), 409);
    expect(db.prepare("select count(*) as n from duels").get()).toEqual({ n: 0 });
  });

  it("keeps ordinary private invites and human seats working", () => {
    const duel = create({ sandbox: false, settings: { visibility: "private" } });
    const invite = duels.room(duel.slug, "g", owner).inviteCode!;
    expect(invite).toBeTruthy();
    duels.admit(duel.slug, "g", viewer, invite);
    expect(duels.takeSeat(duel.slug, "g", viewer).seats).toHaveLength(2);
  });

  it("rejects seat claims and invites with 409", () => {
    const duel = create();
    status(() => duels.takeSeat(duel.slug, "g", owner), 409);
    status(() => duels.takeSeat(duel.slug, "g", viewer, 1), 409);
    status(() => duels.admit(duel.slug, "g", viewer, "code"), 409);
  });

  it("denies viewers even if a stale invite grant exists", () => {
    const duel = create();
    db.prepare("insert into duel_invite_grants (duel_id, player_id) values (?, ?)").run(duel.id, viewer);
    status(() => duels.room(duel.slug, "g", viewer), 403);
    expect(duels.room(duel.slug, "g", owner).mySeat).toBe(0);
    status(() => duels.get(duel.slug, "other-guild"), 404);
  });

  it("allows explicit bot seats during setup, then blocks add/remove bot and opening", () => {
    const duel = create({ format: "ffa3", settings: { validateDeck: false } });
    status(() => duels.addPracticeBot(duel.slug, "g", owner, deck), 409);
    expect(duels.addPracticeBot(duel.slug, "g", owner, deck, 1).seats).toHaveLength(2);
    duels.setSetup(duel.slug, "g", { sandbox: { board: parseSandboxBoard({ format: "ffa3" }), run } });
    status(() => duels.addPracticeBot(duel.slug, "g", owner, deck, 2), 409);
    status(() => duels.removePracticeBot(duel.slug, "g", owner, 1), 409);
    status(() => duels.startOpening(duel.slug, "g", owner, Date.now()), 409);
  });

  it("accepts the sandbox Extra Deck limit for both owner and bot", () => {
    const duel = create({ settings: { validateDeck: false } });
    const large = { ...deck, extra: Array.from({ length: 30 }, (_, i) => i + 1) };
    duels.setDeck(duel.slug, "g", owner, large);
    duels.addPracticeBot(duel.slug, "g", owner, large, 1);
    expect(duels.privateState(duel.slug, "g").decks).toEqual([large, large]);
    status(() => duels.setDeck(duel.slug, "g", owner, { ...large, extra: [...large.extra, 31] }), 400);
    const normal = create({ sandbox: false, settings: { validateDeck: false } });
    status(() => duels.setDeck(normal.slug, "g", owner, large), 400);
  });

  it("rejects series links before activation and completion", () => {
    const normal = create({ sandbox: false, settings: { validateDeck: false } });
    duels.takeSeat(normal.slug, "g", viewer);
    duels.setDeck(normal.slug, "g", owner, deck);
    duels.setDeck(normal.slug, "g", viewer, deck);
    const linked = duels.activate(normal.slug, "g", owner, run.seed!, "test", null);
    expect(linked.seriesId).not.toBeNull();
    const lobby = ready();
    const active = start();
    for (const duel of [lobby, active]) {
      db.prepare("update duels set series_id = ?, game_number = 1 where id = ?").run(linked.seriesId, duel.id);
    }
    status(() => duels.activate(lobby.slug, "g", owner, run.seed!, "test", null, sandboxSetup()), 409);
    status(() => duels.complete(active.slug, "g", 0, "done"), 409);
    expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
  });

  it("retains board, modes, seed, and scenario ID across activation and service recovery", () => {
    const duel = start();
    expect(duels.privateState(duel.slug, "g").setup).toEqual(sandboxSetup());
    const setup = sandboxSetup();
    setup.sandbox!.run = { ...run, bots: { ...run.bots, "1": "manual" } };
    duels.setSetup(duel.slug, "g", setup);
    const recovered = createDuelService(db).privateState(duel.slug, "g");
    expect(recovered.setup).toEqual(setup);
    expect(recovered.seed).toEqual(run.seed);
    expect(recovered.session.sandbox).toBe(true);
  });

  it.each([
    null,
    { board: { teams: [[0, 1]] }, run },
    { board: {}, run: { bots: { "1": "invalid" } } },
    { board: {}, run, scenarioId: -1 },
    { board: {}, run, scenarioId: "17" },
    { board: {}, run, extra: true },
  ])("rejects invalid sandbox setup %j", (sandbox) => {
    const duel = create();
    status(() => duels.setSetup(duel.slug, "g", { sandbox } as unknown as DuelSetup), 400);
    expect(duels.privateState(duel.slug, "g").setup).toBeUndefined();
  });

  it("rejects sandbox setup on an ordinary duel", () => {
    const duel = create({ sandbox: false });
    status(() => duels.setSetup(duel.slug, "g", sandboxSetup()), 409);
  });

  it("keeps ordinary setup fields when storing sandbox data", () => {
    const duel = ready();
    const setup: DuelSetup = { ...sandboxSetup(), firstTurnDraw: true, startupScripts: ["-- generated"], engine: "pinned" };
    duels.setSetup(duel.slug, "g", setup);
    expect(duels.privateState(duel.slug, "g").setup).toEqual(setup);
  });

  it("does not attach a series or write matches when a sandbox finishes", () => {
    const duel = start();
    expect(duel.seriesId).toBeNull();
    duels.complete(duel.slug, "g", 0, "done");
    expect(db.prepare("select count(*) as n from duel_series").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
  });

  it.each(["ranked = 1", "best_of = 3"])("rejects unsafe stored match options before start: %s", (assignment) => {
    const duel = ready();
    db.prepare(`update duels set ${assignment} where id = ?`).run(duel.id);
    status(() => duels.activate(duel.slug, "g", owner, run.seed!, "test", null, sandboxSetup()), 409);
    expect(duels.get(duel.slug, "g").status).toBe("lobby");
  });

  it("excludes sandbox lobbies, active duels, and history for all viewers", () => {
    const normal = create({ sandbox: false });
    const sandbox = ready();
    for (const player of [owner, viewer]) {
      expect(duels.list("g", player).map((d) => d.slug)).toEqual([normal.slug]);
      expect(createLiveNowService(db).forPlayer("g", player)).toEqual({ yourDuel: null, liveCount: 0 });
    }
    duels.activate(sandbox.slug, "g", owner, run.seed!, "test", null, sandboxSetup());
    for (const player of [owner, viewer]) {
      expect(duels.list("g", player).map((d) => d.slug)).toEqual([normal.slug]);
      expect(createLiveNowService(db).forPlayer("g", player)).toEqual({ yourDuel: null, liveCount: 0 });
    }
    duels.complete(sandbox.slug, "g", 0, "done");
    for (const player of [owner, viewer]) {
      for (const scope of ["mine", "all"] as const) expect(duels.list("g", player, { archived: true, scope })).toEqual([]);
    }
  });
});
