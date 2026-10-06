import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { parseSandboxBoard, type SandboxRun } from "../../src/duels/sandbox-board.js";
import { createPlayerService } from "../../src/services/players.js";
import * as services from "../../src/services/index.js";
import {
  createSandboxScenarioService,
  SandboxScenarioServiceError,
} from "../../src/services/sandbox-scenarios.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const run: SandboxRun = { bots: { "1": "pass", "2": "practice", "3": "manual" }, seed: ["1", "2", "3", "4"] };
const input = { name: "  My board  ", board: { p0: { hand: [89631139] } }, run };

function setup() {
  const db = setupDatabase();
  const players = createPlayerService(db);
  const owner = players.findOrCreate("g", "owner", "Owner").id;
  const other = players.findOrCreate("g", "other", "Other").id;
  const foreign = players.findOrCreate("elsewhere", "owner", "Owner").id;
  return { db, owner, other, foreign, scenarios: createSandboxScenarioService(db) };
}

function expectStatus(work: () => unknown, status: number, path?: string) {
  try {
    work();
    expect.fail("Expected SandboxScenarioServiceError");
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxScenarioServiceError);
    expect(error).toMatchObject({ status, ...(path === undefined ? {} : { path }) });
  }
}

describe("sandbox scenario service", () => {
  it("exports the factory and error through the services entry point", () => {
    expect(services.createSandboxScenarioService).toBe(createSandboxScenarioService);
    expect(services.SandboxScenarioServiceError).toBe(SandboxScenarioServiceError);
  });

  it("saves parsed defaults, a trimmed name, seed, and metadata", () => {
    const { db, owner, scenarios } = setup();
    const saved = scenarios.create("g", owner, input);
    expect(saved).toEqual({
      id: expect.any(Number), guildId: "g", ownerPlayerId: owner, name: "My board",
      format: "1v1", mode: "normal", board: parseSandboxBoard(input.board), run,
      createdAt: expect.any(String), updatedAt: expect.any(String),
    });
    const row = db.prepare("select * from sandbox_scenarios where id = ? and guild_id = ?")
      .get(saved.id, "g") as { board_json: string; run_json: string };
    expect(JSON.parse(row.board_json)).toEqual(saved.board);
    expect(JSON.parse(row.run_json)).toEqual(run);
    migrate(db);
    expect(scenarios.get(saved.id, "g")).toEqual(saved);
  });

  it("lists all guild owners and sorts by updated time then descending id", () => {
    const { db, owner, other, foreign, scenarios } = setup();
    const first = scenarios.create("g", owner, input);
    const second = scenarios.create("g", other, input);
    const third = scenarios.create("g", owner, input);
    scenarios.create("elsewhere", foreign, input);
    db.prepare("update sandbox_scenarios set updated_at = ? where guild_id = ?").run("2000-01-01 00:00:00", "g");
    db.prepare("update sandbox_scenarios set updated_at = ? where id = ? and guild_id = ?")
      .run("2001-01-01 00:00:00", first.id, "g");
    expect(scenarios.list("g").map((scenario) => scenario.id)).toEqual([first.id, third.id, second.id]);
    expect(scenarios.list("missing")).toEqual([]);
  });

  it("allows another guild admin to read and save a copy, but not change the original", () => {
    const { owner, other, scenarios } = setup();
    const saved = scenarios.create("g", owner, input);
    const opened = scenarios.get(saved.id, "g");
    expectStatus(() => scenarios.update(saved.id, "g", other, input), 403);
    expectStatus(() => scenarios.delete(saved.id, "g", other), 403);
    const copy = scenarios.create("g", other, opened);
    expect(copy.id).not.toBe(saved.id);
    expect(copy.ownerPlayerId).toBe(other);
    expect(copy.board).toEqual(saved.board);
    expect(scenarios.get(saved.id, "g")).toEqual(saved);
  });

  it("hides other guilds and missing ids from every id operation", () => {
    const { owner, foreign, scenarios } = setup();
    const saved = scenarios.create("g", owner, input);
    for (const [id, guild, actor] of [[saved.id, "elsewhere", foreign], [saved.id + 100, "g", owner]] as const) {
      expectStatus(() => scenarios.get(id, guild), 404);
      expectStatus(() => scenarios.update(id, guild, actor, input), 404);
      expectStatus(() => scenarios.delete(id, guild, actor), 404);
    }
    expect(scenarios.get(saved.id, "g")).toEqual(saved);
  });

  it("requires a real owner in the scenario guild", () => {
    const { foreign, scenarios } = setup();
    expectStatus(() => scenarios.create("g", foreign, input), 404);
    expectStatus(() => scenarios.create("g", 999999, input), 404);
    expect(scenarios.list("g")).toEqual([]);
  });

  it("updates the board, derived format/mode, run and timestamp; only the owner can delete", () => {
    const { db, owner, scenarios } = setup();
    const saved = scenarios.create("g", owner, input);
    db.prepare("update sandbox_scenarios set updated_at = ? where id = ? and guild_id = ?")
      .run("2000-01-01 00:00:00", saved.id, "g");
    const next = { name: " Domain test ", board: { format: "ffa3", mode: "domain",
      p0: { deckMaster: 1 }, p1: { deckMaster: 2 }, p2: { deckMaster: 3 } },
      run: { bots: { "1": "manual", "2": "pass", "3": "pass" } } };
    const updated = scenarios.update(saved.id, "g", owner, next);
    expect(updated).toMatchObject({ id: saved.id, ownerPlayerId: owner, name: "Domain test", format: "ffa3",
      mode: "domain", board: parseSandboxBoard(next.board), run: next.run, createdAt: saved.createdAt });
    expect(updated.updatedAt).not.toBe("2000-01-01 00:00:00");
    scenarios.delete(saved.id, "g", owner);
    expectStatus(() => scenarios.get(saved.id, "g"), 404);
  });

  it.each([null, 42, "", " \n ", "x".repeat(81)])("rejects an invalid name: %j", (name) => {
    const { owner, scenarios } = setup();
    const saved = scenarios.create("g", owner, input);
    expectStatus(() => scenarios.create("g", owner, { ...input, name }), 400);
    expectStatus(() => scenarios.update(saved.id, "g", owner, { ...input, name }), 400);
    expect(scenarios.list("g")).toEqual([saved]);
  });

  it("accepts an 80-character name after trimming", () => {
    const { owner, scenarios } = setup();
    expect(scenarios.create("g", owner, { ...input, name: ` ${"x".repeat(80)} ` }).name).toHaveLength(80);
  });

  it.each([
    [{ ...input, board: { withoutCoreFunctions: [] } }, "withoutCoreFunctions"],
    [{ ...input, board: { p0: { hand: ["Dark Magician"] } } }, "p0.hand[0]"],
    [{ ...input, board: { startAt: "main1" } }, "startAt"],
    [{ ...input, run: { bots: { "1": "invalid", "2": "pass", "3": "pass" } } }, "bots.1"],
    [{ ...input, run: { ...run, seed: ["0", "2", "3", "4"] } }, "seed[0]"],
    [{ ...input, run: { ...run, seed: ["0".repeat(1024) + "1", "2", "3", "4"] } }, "$"],
  ])("uses B1 validation for create and update (%s)", (invalid, path) => {
    const { owner, scenarios } = setup();
    const saved = scenarios.create("g", owner, input);
    expectStatus(() => scenarios.create("g", owner, invalid), 400, path);
    expectStatus(() => scenarios.update(saved.id, "g", owner, invalid), 400, path);
    expect(scenarios.list("g")).toEqual([saved]);
  });

  it("rejects a structurally valid board above 32 KiB without writing it", () => {
    const { owner, scenarios } = setup();
    const card = { card: 4294967295, pos: "atk", summoned: true, materials: Array(10).fill(4294967295) };
    const seat = { hand: Array(20).fill(card), monsters: Array(7).fill(card), spells: Array(5).fill(card),
      field: card, pendulum: [card, card], grave: Array(60).fill(4294967295), banished: Array(60).fill(4294967295),
      deck: Array(60).fill(4294967295), extra: Array(30).fill(4294967295) };
    const board = { format: "ffa4", deckSize: 60, p0: seat, p1: seat, p2: seat, p3: seat };
    expect(Buffer.byteLength(JSON.stringify(board))).toBeGreaterThan(32 * 1024);
    expectStatus(() => scenarios.create("g", owner, { ...input, board }), 400, "$");
    expect(scenarios.list("g")).toEqual([]);
  });

  it("limits each owner to 200 scenarios in a guild, and frees a slot on delete", () => {
    const { owner, other, foreign, scenarios } = setup();
    const saved = Array.from({ length: 200 }, () => scenarios.create("g", owner, input));
    expectStatus(() => scenarios.create("g", owner, input), 409);
    expect(scenarios.list("g")).toHaveLength(200);
    expect(scenarios.update(saved[0].id, "g", owner, { ...input, name: "Changed" }).name).toBe("Changed");
    expect(scenarios.create("g", other, input).ownerPlayerId).toBe(other);
    expect(scenarios.create("elsewhere", foreign, input).guildId).toBe("elsewhere");
    scenarios.delete(saved[0].id, "g", owner);
    expect(scenarios.create("g", owner, input).id).toBeGreaterThan(saved[199].id);
  });
});

function setupDatabase() {
  const db = new Database(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

describe("sandbox scenario migration", () => {
  it("creates the table, guild index, and owner foreign key on repeated migration", () => {
    const db = setupDatabase();
    migrate(db);
    const columns = db.prepare("pragma table_info(sandbox_scenarios)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id", "guild_id", "owner_player_id", "name", "format", "mode", "board_json", "run_json", "created_at", "updated_at",
    ]);
    const indexes = db.prepare("pragma index_list(sandbox_scenarios)").all() as Array<{ name: string }>;
    expect(indexes.some(({ name }) => {
      const fields = db.prepare(`pragma index_info('${name}')`).all() as Array<{ name: string }>;
      return fields.map((field) => field.name).join(",") === "guild_id,updated_at";
    })).toBe(true);
    expect(db.prepare("pragma foreign_key_list(sandbox_scenarios)").all()).toEqual([
      expect.objectContaining({ table: "players", from: "owner_player_id", to: "id" }),
    ]);
  });
});
