import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { parseSandboxBoard, type DuelEngineView, type SandboxRun } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker } from "../src/worker-client.js";
import { compileBoard } from "../src/presets/board.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const resources: Array<{ host: DuelHost; db: Database.Database }> = [];
afterEach(async () => {
  for (const { host, db } of resources.splice(0)) { await host.close(); db.close(); }
});
const run: SandboxRun = { bots: { "1": "manual", "2": "manual", "3": "manual" }, seed: ["1", "2", "3", "4"] };
function setup(probe = false) {
  const db = new Database(":memory:");
  migrate(db);
  const player = (name: string) => Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)").run(name, name).lastInsertRowid);
  const owner = player("owner"), other = player("other");
  const duels = createDuelService(db), workers: GameWorker[] = [];
  const beforeElimination: DuelEngineView[] = [];
  const host = createDuelHost({ db, dataDirectory: DATA, secret: "h1", searchCards: () => [],
    pollIntervalMs: 3_600_000, idleWorkerMs: 3_600_000, stallMs: 0, queueBlockedMs: 0,
    createWorker: () => {
      const worker = new GameWorker(); workers.push(worker);
      const create = worker.create.bind(worker), eliminate = worker.eliminate.bind(worker);
      worker.eliminate = async (seat, reason, atTurnEnd) => {
        beforeElimination.push(await worker.view(0));
        return eliminate(seat, reason, atTurnEnd);
      };
      if (probe) worker.create = (options) => create({ ...options, startupScripts: [...options.startupScripts ?? [], {
        name: "h1-column-probe.lua", content: `
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE+PHASE_DRAW)
e:SetCountLimit(1)
e:SetOperation(function()
  local alive=0
  for p=0,3 do if Duel.MPIsAlive(p) then alive=alive+1 end end
  local c=Duel.GetFieldCard(0,LOCATION_MZONE,2)
  local column=c:GetColumnGroup():GetCount()
  Duel.AnnounceNumber(0,alive*100+column)
end)
Duel.RegisterEffect(e,0)` }] });
      return worker;
    } });
  resources.push({ db, host });
  async function post(op: string, extra: Record<string, unknown> = {}) {
    const raw = JSON.stringify({ guildId: "g", playerId: owner, op, ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", "h1").update(raw).digest("hex") } }));
    return { status: response.status, data: await response.json() as any };
  }
  async function start(board: Record<string, unknown>, overrideRun = run) {
    const result = await post("start-sandbox", { board, run: overrideRun });
    expect(result.status, result.data.error).toBe(200);
    return result.data;
  }
  return { db, duels, workers, beforeElimination, owner, other, post, start };
}

it("compiles eliminated Domain seats without filler or Deck Masters", () => {
  const compiled = compileBoard(parseSandboxBoard({ mode: "domain", format: "ffa4", eliminated: ["p2"],
    p0: { deckMaster: 15025844 }, p1: { deckMaster: 15025844 }, p3: { deckMaster: 15025844 } }), DATA);
  expect(compiled.options.decks[2]).toEqual({ main: [], extra: [], side: [] });
});

describeWithCores("H1 sandbox real core", [needs.cards(DATA), needs.standard(DATA), needs.installedMulti(DATA)], () => {
  it("eliminates p2 before turn 1; the real column query sees three living seats", async () => {
    const t = setup(true);
    const { slug } = await t.start({ format: "ffa4", eliminated: ["p2"], startAt: "main1",
      p0: { monsters: [null, null, 15025844] }, p1: { monsters: [null, null, 15025844] }, p2: { lp: 0 } });
    expect(t.beforeElimination[0].turn).toBe(0);
    const room = (await t.post("view", { slug })).data;
    expect(room.engine.seats.filter((s: any) => !s.eliminated)).toHaveLength(3);
    expect(room.engine.seats[2]).toMatchObject({ eliminated: true, lp: 0, deckCount: 0, hand: [] });
    expect(room.engine.prompt.options[0].values[0]).toBe(301);
    expect(t.duels.privateState(slug, "g").commands.some(c => c.seat === 2 && c.command.promptId === "eliminate:0")).toBe(true);
    await t.workers[0].close();
    expect((await t.post("view", { slug })).data.engine).toEqual(room.engine);
    const restarted = await t.post("sandbox-restart", { slug });
    expect(restarted.status, restarted.data.error).toBe(200);
    expect((await t.post("view", { slug: restarted.data.slug })).data.engine).toEqual(room.engine);
  }, 30_000);

  it.each(["draw", "standby", "main1", "battle", "main2", "end"])("starts ffa3 at real %s and holds it on reads", async (startAt) => {
    const t = setup();
    const started = await t.start({ format: "ffa3", startAt, attackFirstTurn: true });
    const room = (await t.post("view", { slug: started.slug })).data;
    expect(room.engine.phase).toBe(startAt === "battle" ? "battle_start" : startAt);
    expect(room.engine.turn).toBe(1);
    await t.workers[0].close();
    expect((await t.post("view", { slug: started.slug })).data.engine).toEqual(room.engine);
  }, 30_000);

  it("starts with p0 and p2 out and holds a bot turn through restart", async () => {
    const t = setup();
    const { slug } = await t.start({ format: "ffa4", turn: "p1", eliminated: ["p0", "p2"], startAt: "main1" },
      { ...run, bots: { "1": "pass", "2": "pass", "3": "pass" } });
    expect(t.beforeElimination.map(view => view.turn)).toEqual([0, 0]);
    const first = (await t.post("view", { slug })).data.engine;
    expect(first).toMatchObject({ phase: "main1", turnSeat: 1 });
    expect(first.seats.filter((s: any) => !s.eliminated).map((s: any) => s.seat)).toEqual([1, 3]);
    const restarted = await t.post("sandbox-restart", { slug });
    expect(restarted.status, restarted.data.error).toBe(200);
    expect((await t.post("view", { slug: restarted.data.slug })).data.engine).toEqual(first);
  }, 30_000);

  it("reports a blocked Battle start without advancing to another turn", async () => {
    const t = setup();
    const result = await t.start({ format: "ffa3", turn: "p1", startAt: "battle" });
    expect(result.start).toMatchObject({ reached: false, phase: "main1", turn: 2, requested: "battle" });
    expect((await t.post("view", { slug: result.slug })).data.engine).toMatchObject({ phase: "main1", turn: 2 });
  }, 30_000);

  it("reports a start stopped by a real Standby effect", async () => {
    const t = setup();
    const result = await t.start({ format: "ffa3", startAt: "main1", p0: { grave: [12538374] } });
    expect(result.start).toMatchObject({ reached: false, phase: "standby", requested: "main1" });
    expect(JSON.stringify((await t.post("view", { slug: result.slug })).data.engine.prompt)).toContain("12538374");
  }, 30_000);

  it("eliminates mid-duel, journals it, and refuses already-out or last-two seats", async () => {
    const t = setup(), { slug } = await t.start({ format: "ffa4", startAt: "main1", p2: { monsters: [15025844] } });
    const gone = await t.post("sandbox-eliminate", { slug, seat: 2 });
    expect(gone.status, gone.data.error).toBe(200);
    expect(gone.data.engine.seats[2]).toMatchObject({ eliminated: true, deckCount: 0 });
    expect(gone.data.engine.seats[2].monsters.every((c: any) => c === null)).toBe(true);
    expect((await t.post("sandbox-eliminate", { slug, seat: 2 })).status).toBe(409);
    expect((await t.post("sandbox-eliminate", { slug, seat: 3 })).status).toBe(200);
    expect((await t.post("sandbox-eliminate", { slug, seat: 1 })).status).toBe(409);
    expect(t.duels.privateState(slug, "g").commands.filter(c => c.command.promptId === "eliminate:0").map(c => c.seat)).toEqual([2, 3]);
    await t.workers[0].close();
    expect((await t.post("view", { slug })).data.engine.seats.filter((s: any) => !s.eliminated)).toHaveLength(2);
  }, 30_000);

  it("checks ownership, format, seat, and active status; Close is idempotent", async () => {
    const t = setup(), { slug } = await t.start({ format: "ffa4" });
    const regular = t.duels.create({ guildId: "g", organizerPlayerId: t.owner, name: "Regular", mode: "normal" });
    for (const op of ["sandbox-eliminate", "sandbox-close"]) {
      expect((await t.post(op, { slug, seat: 2, playerId: t.other })).status).toBe(403);
      expect((await t.post(op, { slug, seat: 2, guildId: "wrong" })).status).toBe(404);
      expect((await t.post(op, { slug: regular.slug, seat: 2 })).status).toBe(409);
    }
    for (const seat of [-1, 4, "2", 1.5]) expect((await t.post("sandbox-eliminate", { slug, seat })).status).toBe(400);
    for (const format of ["1v1", "tag"]) {
      const started = await t.start({ format });
      expect((await t.post("sandbox-eliminate", { slug: started.slug, seat: 1 })).status).toBe(409);
      expect((await t.post("start-sandbox", { board: { format, eliminated: ["p1"] }, run })).status).toBe(400);
    }
    expect(await t.post("sandbox-close", { slug })).toEqual({ status: 200, data: { ok: true } });
    expect(t.duels.get(slug, "g").status).toBe("cancelled");
    expect(t.workers[0].running).toBe(false);
    expect(await t.post("sandbox-close", { slug })).toEqual({ status: 200, data: { ok: true } });
    expect((await t.post("sandbox-eliminate", { slug, seat: 1 })).status).toBe(409);
  }, 30_000);
});
