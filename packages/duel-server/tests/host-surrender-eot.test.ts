import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, teamOfSeat, type DuelAnswer, type DuelEngineView, type DuelFormat, type DuelMode, type DuelRoom, type DuelReplay } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker } from "../src/worker-client.js";
import { buildPracticeBotDeck, chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { resolveCard } from "../src/presets/catalog.js";
import { compileBoard, type BoardSpec } from "../src/presets/board.js";
import { activeMultiScriptsHash, pinnedEngineVersion } from "../src/multi-scripts.js";
import { loadSource, replaySource, type DuelSource } from "../scripts/lib/replay-source.js";
import { parseJournalText } from "../scripts/lib/journal-file.js";
import { loadNSource, replaySeats } from "../scripts/failure-to-scenario.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "surrender-eot-test";
class TestWorker extends GameWorker {
  holdViews = false;
  private readonly heldViews: Array<() => void> = [];

  override async view(seat: number | null): Promise<DuelEngineView> {
    if (this.holdViews) await new Promise<void>((resolve) => this.heldViews.push(resolve));
    return super.view(seat);
  }

  releaseViews() {
    this.holdViews = false;
    for (const resolve of this.heldViews.splice(0)) resolve();
  }
}
const hosts: DuelHost[] = [];
const databases: Database.Database[] = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.close();
  while (databases.length) databases.pop()!.close();
});

async function table(mode: DuelMode, format: DuelFormat, chain = false, extraScripts: string[] = [], queueBlockedMs = 30_000) {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const count = seatCountFor(format);
  const players = Array.from({ length: count }, (_, seat) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)",
  ).run("g", `u${seat}`, `P${seat}`).lastInsertRowid));
  const service = createDuelService(db);
  const session = service.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Turn-end surrender", mode, format,
    settings: { banlist: "none", turnSeconds: 60, startingHand: 0, drawPerTurn: 0, shuffleDeck: false } });
  for (const player of players.slice(1)) service.join(session.slug, "g", player);
  const deck = buildPracticeBotDeck(mode, DATA);
  for (const player of players) service.setDeck(session.slug, "g", player, deck);
  const board: BoardSpec = { mode, format };
  for (let seat = 0; seat < count; seat++) board[`p${seat}` as "p0"] = {
    hand: [chain && seat === 0 ? "Pot of Greed" : "Mystical Elf"], monsters: ["Beaver Warrior"],
    ...(mode === "domain" ? { deckMaster: deck.deckMaster } : {}),
    ...(chain && seat !== 0 ? { spells: [{ card: "Dust Tornado", pos: "set" }] } : {}),
  };
  const scripts = compileBoard(board, DATA).options.startupScripts!.map((script) => script.content);
  // Keep a real prompt open in the End Phase, before EVENT_TURN_END.
  if (!chain) scripts.push(`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_END)
e:SetOperation(function() Duel.SelectYesNo(0,30) end)
Duel.RegisterEffect(e,0)`);
  scripts.push(...extraScripts);
  service.activate(session.slug, "g", players[0]!, ["1", "2", "3", "4"], pinnedEngineVersion(JSON.parse(readFileSync(`${DATA}/manifest.json`, "utf8")).bundleVersion, count, count > 2 ? activeMultiScriptsHash(DATA) : null),
    { turn: 1, remainingMs: Array(count).fill(60_000), activeSeat: 0, startedAt: Date.now() },
    { startupScripts: scripts, firstTurnDraw: mode === "domain" });
  const workers: TestWorker[] = [];
  const makeHost = () => {
    const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000,
      queueBlockedMs, createWorker: () => { const worker = new TestWorker(); workers.push(worker); return worker; } });
    hosts.push(host);
    return host;
  };
  let host = makeHost();
  const post = async (op: string, seat = 0, extra: Record<string, unknown> = {}, expectedStatus = 200) => {
    const raw = JSON.stringify({ op, slug: session.slug, guildId: "g", playerId: players[seat], ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
    const data = await response.json() as DuelRoom & { error?: string };
    expect(response.status, data.error).toBe(expectedStatus);
    return data;
  };
  const view = async (seat = 0) => (await post("view", seat)).engine!;
  const answer = async (seat: number, answer: DuelAnswer) => {
    const before = await view(seat);
    expect(before.prompt).not.toBeNull();
    return post("respond", seat, { command: { revision: before.revision, promptId: before.prompt!.id, answer } });
  };
  const source = (): DuelSource => {
    const state = service.privateState(session.slug, "g");
    return { kind: "journal", label: "Turn-end surrender", mode, format, masterRule: state.session.masterRule,
      decks: state.decks, seed: state.seed!, settings: state.session.settings, firstTurnDraw: state.setup!.firstTurnDraw,
      startupScripts: state.setup!.startupScripts!.map((content, index) => ({ name: `startup-${index}.lua`, content })),
      commands: state.commands.map(({ seat, command }) => ({ seat, ...command })) };
  };
  return { db, service, session, count, players, post, view, answer, source, workers,
    recover: async () => { await host.close(); host = makeHost(); return view(); } };
}

const states = (view: DuelEngineView) => view.seats.map((seat) => seat.eliminated ? "out" : seat.pendingElimination ? "pending" : "in");
const allIn = (view: DuelEngineView, count: number) => {
  expect(states(view)).toEqual(Array(count).fill("in"));
  for (const seat of view.seats) {
    expect(seat.monsters.filter(Boolean).map((card) => card!.code)).toEqual([32452818]);
    expect(seat.hand).toHaveLength(1);
  }
};

for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`${mode} host surrender at the end of the turn`, [needs.cards(DATA),
    mode === "domain" ? needs.domainMulti(DATA, `${DATA}/ocgcore.multi-domain.wasm`) : needs.installedMulti(DATA)], () => {
    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s stays through the End Phase and recovers the queue", async (format) => {
      const t = await table(mode, format);
      const leaver = format === "tag" ? 1 : t.count - 1;
      const before = await t.view();
      expect(before.phase).toBe("main1");
      const queued = await t.post("surrender", leaver);
      expect(queued.role).toBe("player");
      allIn(queued.engine!, t.count);
      expect((await t.view()).prompt?.id).toBe(before.prompt?.id);
      expect(t.service.get(t.session.slug, "g").status).toBe("active");
      expect(t.source().commands[0]?.promptId).toBe("eliminate-eot:0");
      await t.post("respond", leaver, { command: { revision: queued.engine!.revision, promptId: before.prompt!.id, answer: { choice: "to_ep" } } }, 409);
      expect(t.service.privateState(t.session.slug, "g").clock?.activeSeat).toBe(0);
      const live = await Promise.all(Array.from({ length: t.count }, (_, seat) => t.view(seat)));
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayed.seats).toEqual(live);
      await t.recover();
      expect(await Promise.all(Array.from({ length: t.count }, (_, seat) => t.view(seat)))).toEqual(live);
      await t.answer(0, { choice: "to_ep" });
      const endPhase = await t.view();
      expect(endPhase.phase).toBe("end");
      allIn(endPhase, t.count);
      await t.answer(0, { choice: "no" });
      const room = await t.post("view", leaver);
      expect(room.role).toBe("spectator");
      expect(room.mySeat).toBeNull();
      expect(room.myDeck).toBeNull();
      expect(room.engine?.prompt).toBeNull();
      const lost = Array.from({ length: t.count }, (_, seat) => format === "tag" ? teamOfSeat(format, seat) === 1 : seat === leaver);
      expect(states(room.engine!)).toEqual(lost.map((gone) => gone ? "out" : "in"));
      for (const seat of room.engine!.seats) if (!lost[seat.seat]) expect(seat.hand.every((card) => card.code == null)).toBe(true);
      if (format === "tag") expect(room.session).toMatchObject({ status: "completed", winnerSeat: 0 });
      else expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      const finalReplay = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(finalReplay.spectator)).toEqual(states(room.engine!));
      if (format !== "tag") t.service.interrupt(t.session.slug, "g", "Test stop", {
        public: finalReplay.spectator, seats: finalReplay.seats, seat0: finalReplay.seats[0], seat1: finalReplay.seats[1],
      });
      const replay = await t.post("replay", leaver) as unknown as DuelReplay;
      expect(replay.role).toBe("spectator");
      expect(replay.mySeat).toBeNull();
      const queuedFrame = replay.frames[1]!.view;
      allIn(queuedFrame, t.count);
      expect(queuedFrame.seats.flatMap((seat) => seat.hand).every((card) => card.code == null)).toBe(true);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s keeps the open-chain loss rule", async (format) => {
      const t = await table(mode, format, true);
      await reachMain(t);
      const start = await t.view();
      const activate = start.prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      expect(activate).toBeDefined();
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 5 && !(await t.view()).chain?.length; step++) await passPrompt(t);
      expect((await t.view()).chain).toHaveLength(1);
      const before = await t.view(1);
      expect(before.prompt).not.toBeNull();
      const queued = await t.post("surrender", 0);
      expect(queued.session.status).toBe("active");
      expect(states(queued.engine!)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === 0 ? "pending" : "in"));
      expect((await t.view(1)).prompt?.id).toBe(before.prompt?.id);
      expect(t.source().commands.at(-1)?.promptId).toBe("eliminate:0");
      const live = await t.view(1);
      await t.recover();
      expect(await t.view(1)).toEqual(live);
      for (let step = 0; step < 20 && (await t.view(1)).chain?.length; step++) await passPrompt(t);
      const final = await t.view(1);
      expect(states(final)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === 0 ? "out" : "in"));
      const deckCount = t.service.privateState(t.session.slug, "g").decks[0]!.main.length;
      // Pot of Greed must not draw two cards after its owner has flagged a loss.
      expect(final.log.some((line) => line.text.includes("drew 2"))).toBe(false);
      for (const seat of final.seats) if (!seat.eliminated) {
        expect(seat.hand).toHaveLength(1);
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
        expect(seat.deckCount).toBe(deckCount);
      }
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(final));
    }, 60_000);

    it.each([0, 3])("R-COMMON-SURRENDER-EOT: Tag seat %s ends an open chain at once", async (leaver) => {
      const t = await table(mode, "tag", true);
      await reachMain(t);
      const start = await t.view();
      const activate = start.prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 5 && !(await t.view()).chain?.length; step++) await passPrompt(t);
      const before = await t.view(1);
      expect(before.chain).toHaveLength(1);
      expect(before.prompt).not.toBeNull();
      const commands = t.source().commands;
      const room = await t.post("surrender", leaver);
      expect(room.session).toMatchObject({ status: "completed", winnerSeat: leaver === 0 ? 1 : 0, resultReason: "Surrender" });
      expect(room.engine).toMatchObject({ turn: before.turn, phase: before.phase, prompt: null });
      expect(room.engine!.chain).toEqual(before.chain);
      expect(t.source().commands).toEqual(commands);
      for (const seat of room.engine!.seats) {
        expect(seat.eliminated).toBe(false);
        expect(seat.hand).toHaveLength(seat.seat === 0 ? 0 : 1);
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
      }
      await t.recover();
      expect((await t.post("view", leaver)).engine).toEqual(room.engine);
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s passes for the turn player until the turn ends", async (format) => {
      const t = await table(mode, format);
      await t.view();
      const room = await t.post("surrender", 0);
      expect(room.role).toBe("spectator");
      expect(states(room.engine!)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === 0 || (format === "tag" && seat === 2) ? "out" : "in"));
      expect(room.engine!.log.some((entry) => entry.text === "end")).toBe(true);
      const commands = t.service.privateState(t.session.slug, "g").commands;
      expect(commands[0]!.command.promptId).toBe("eliminate-eot:0");
      expect(commands.slice(1).map((entry) => entry.command.answer)).toEqual([{ choice: "to_ep" }, { choice: "no" }]);
      if (format === "tag") expect(room.session).toMatchObject({ status: "completed", winnerSeat: 1 });
      else expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      const replayed = await replaySource(t.source(), DATA, commands.length);
      expect(replayed.spectator).toEqual(room.engine);
      for (const seat of replayed.spectator.seats) if (!seat.eliminated) {
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
        expect(seat.hand).toHaveLength(1);
      }
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: an earlier card loss does not block the other queued loss", async () => {
      const burn = resolveCard("Ookazi", DATA);
      const t = await table(mode, "ffa4", false, [`Duel.SetLP(1,400)
Debug.AddCard(${burn},0,0,LOCATION_HAND,0,POS_FACEDOWN)`]);
      await t.view();
      await t.post("surrender", 1);
      await t.post("surrender", 3);
      await activateCard(t, burn);
      const early = await t.view();
      expect(early.phase).toBe("main1");
      expect(states(early)).toEqual(["in", "out", "in", "in"]);
      expect(early.seats.map((seat) => seat.lp)).toEqual([8000, 0, 8000, 8000]);
      expect((await t.post("view", 1)).role).toBe("spectator");
      await t.answer(0, { choice: "to_ep" });
      expect(states(await t.view())).toEqual(["in", "out", "in", "in"]);
      await t.answer(0, { choice: "no" });
      const final = await t.view();
      expect(states(final)).toEqual(["in", "out", "in", "out"]);
      expect(final).toMatchObject({ turn: 2, turnSeat: 2, result: null });
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayed.seats[0]).toEqual(final);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: an early loss of the turn player still ends the queued turn", async () => {
      const burn = resolveCard("Tremendous Fire", DATA);
      const t = await table(mode, "ffa4", true, [`Duel.SetLP(0,400)
Debug.AddCard(${burn},0,0,LOCATION_HAND,0,POS_FACEDOWN)`]);
      await reachMain(t);
      await t.post("surrender", 1);
      await activateCard(t, burn);
      const final = await t.view(2);
      expect(states(final)).toEqual(["out", "out", "in", "in"]);
      expect(final).toMatchObject({ turn: 2, turnSeat: 2, result: null });
      for (const seat of final.seats) if (!seat.eliminated) {
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
        expect(seat.hand).toHaveLength(1);
      }
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayed.seats[2]).toEqual(final);
    }, 60_000);

    it("1v1 surrender still ends the duel at once", async () => {
      const t = await table(mode, "1v1");
      const before = await t.view();
      const final = await t.post("surrender");
      expect(final.session).toMatchObject({ status: "completed", winnerSeat: 1, resultReason: "Surrender" });
      expect(final.engine).toMatchObject({ turn: before.turn, phase: "main1", prompt: null });
      expect(t.source().commands).toEqual([]);
      for (const seat of final.engine!.seats) {
        expect(seat.hand).toHaveLength(1);
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
      }
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: a card result before turn end stays final", async () => {
      const burn = resolveCard("Ookazi", DATA);
      const t = await table(mode, "ffa4", false, [`Duel.SetLP(1,400)
Duel.SetLP(2,0)
Duel.SetLP(3,0)
Debug.AddCard(${burn},0,0,LOCATION_HAND,0,POS_FACEDOWN)`]);
      const initial = await t.view();
      expect(states(initial)).toEqual(["in", "in", "out", "out"]);
      await t.post("surrender", 1);
      expect(t.service.get(t.session.slug, "g").status).toBe("active");
      await activateCard(t, burn);
      const final = await t.view();
      expect(final.phase).toBe("main1");
      expect(states(final)).toEqual(["in", "out", "out", "out"]);
      expect(final.result?.winnerSeat).toBe(0);
      expect(final.result?.reason).not.toBe("Surrendered");
      expect(final.log.some((entry) => entry.text === "end")).toBe(false);
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayed.seats[0].result).toMatchObject(final.result!);
      expect(JSON.parse(JSON.stringify({ ...replayed.seats[0], result: final.result }))).toEqual(final);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: a save error keeps the journal and setup unchanged", async () => {
      const t = await table(mode, "ffa4");
      const before = await t.view();
      t.db.exec(`CREATE TRIGGER reject_surrender_setup BEFORE UPDATE OF setup_json ON duels
        WHEN NEW.setup_json LIKE '%surrenderedSeats%'
        BEGIN SELECT RAISE(ABORT,'Reject surrender setup'); END`);
      await t.post("surrender", 3, {}, 400);
      expect(t.source().commands).toEqual([]);
      expect(t.service.privateState(t.session.slug, "g").setup?.surrenderedSeats).toBeUndefined();
      t.db.exec("DROP TRIGGER reject_surrender_setup");
      expect(await t.view()).toEqual(before);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: a stale view hides the private cards after elimination", async () => {
      const t = await table(mode, "ffa4", false, [], 2500);
      await t.view();
      const queued = await t.post("surrender", 3);
      allIn(queued.engine!, t.count);
      expect(queued.engine!.seats[3]!.hand[0]!.code).not.toBeNull();
      await t.answer(0, { choice: "to_ep" });
      const ended = await t.answer(0, { choice: "no" });
      expect(states(ended.engine!)).toEqual(["in", "in", "in", "out"]);
      const worker = t.workers.at(-1)!;
      worker.holdViews = true;
      try {
        const stale = await t.post("view", 3) as DuelRoom & { stale: boolean };
        expect(stale.stale).toBe(true);
        expect(stale.role).toBe("spectator");
        expect(stale.mySeat).toBeNull();
        expect(stale.myDeck).toBeNull();
        expect(stale.engine).toBeNull();
      } finally {
        worker.releaseViews();
      }
    }, 60_000);

    it.each([false, true])("R-COMMON-SURRENDER-EOT: an interruption with no final board keeps the spectator role (chain %s)", async (chain) => {
      const t = await table(mode, "ffa4", chain);
      const leaver = chain ? 0 : 3;
      await reachMain(t);
      if (chain) {
        const start = await t.view();
        const activate = start.prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
        await t.answer(0, { choice: activate!.id });
        for (let step = 0; step < 5 && !(await t.view()).chain?.length; step++) await passPrompt(t);
        expect((await t.view()).chain).toHaveLength(1);
      }
      await t.post("surrender", leaver);
      if (chain) {
        for (let step = 0; step < 20 && (await t.view(1)).chain?.length; step++) await passPrompt(t);
      } else {
        await t.answer(0, { choice: "to_ep" });
        await t.answer(0, { choice: "no" });
      }
      expect(states(await t.view(1))).toEqual(Array.from({ length: t.count }, (_, seat) => seat === leaver ? "out" : "in"));
      t.service.interrupt(t.session.slug, "g", "Test interruption");
      await t.recover();
      const room = await t.post("view", leaver);
      expect(room.role).toBe("spectator");
      expect(room.mySeat).toBeNull();
      expect(room.myDeck).toBeNull();
      expect(room.engine).toBeNull();
      const replay = await t.post("replay", leaver) as unknown as DuelReplay;
      expect(replay.role).toBe("spectator");
      expect(replay.mySeat).toBeNull();
      expect(replay.frames[1]!.view.seats.flatMap((seat) => seat.hand).every((card) => card.code == null)).toBe(true);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: a later End Phase keeps the queued seat in the duel", async () => {
      const t = await table(mode, "ffa4", false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_TURN_END)
e:SetOperation(function() Duel.SelectYesNo(0,30) end)
Duel.RegisterEffect(e,0)`]);
      await t.view();
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      await t.answer(0, { choice: "no" });
      expect(await t.view(1)).toMatchObject({ turn: 2, turnSeat: 1 });
      await t.answer(1, { choice: "to_ep" });
      const queued = await t.post("surrender", 3);
      allIn(queued.engine!, t.count);
      expect(queued.engine).toMatchObject({ turn: 2, phase: "end" });
      await t.answer(0, { choice: "no" });
      allIn(await t.view(), t.count);
      await t.answer(0, { choice: "no" });
      const final = await t.view();
      expect(states(final)).toEqual(["in", "in", "in", "out"]);
      expect(final).toMatchObject({ turn: 3, turnSeat: 2 });
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayed.seats[0]).toEqual(final);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: the report journal replays the queue at its saved step", async () => {
      const dir = mkdtempSync(join(tmpdir(), "surrender-eot-report-"));
      const oldScenarios = process.env.DUEL_SCENARIOS;
      const oldReports = process.env.DUEL_REPORT_DIR;
      process.env.DUEL_SCENARIOS = "1";
      process.env.DUEL_REPORT_DIR = dir;
      try {
        const t = await table(mode, "ffa4");
        await t.view();
        await t.post("surrender", 3);
        const queued = await Promise.all(Array.from({ length: t.count }, (_, seat) => t.view(seat)));
        const report = await t.post("report", 0, { note: "Test the saved surrender step" }) as unknown as { path: string };
        const file = join(report.path, "journal.jsonl");
        const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        expect(lines[0].setup.surrenderedSeats).toEqual([3]);
        expect(lines.slice(1)).toEqual([expect.objectContaining({ type: "eliminate", seq: 1, seat: 3,
          command: expect.objectContaining({ promptId: "eliminate-eot:0" }) })]);
        const source = loadSource(file);
        expect((await replaySource(source, DATA, source.commands.length)).seats).toEqual(queued);
        const flatFile = join(dir, "journal.json");
        writeFileSync(flatFile, JSON.stringify(parseJournalText(readFileSync(file, "utf8"))));
        expect((await replaySeats(loadNSource(flatFile), DATA, source.commands.length)).seats).toEqual(queued);
        const runCli = (journal: string, stopAt?: number) => JSON.parse(execFileSync("npx", ["tsx", "scripts/replay-journal.ts",
          journal, "--data", DATA, "--json", "--views", ...(stopAt === undefined ? [] : ["--stop-at", String(stopAt)])],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
        const mid = runCli(file);
        expect(mid).toMatchObject({ ok: true, replayed: 1, total: 1 });
        for (let seat = 0; seat < t.count; seat++) expect(mid.views[String(seat)]).toEqual(queued[seat]);
        await t.answer(0, { choice: "to_ep" });
        await t.answer(0, { choice: "no" });
        const final = await Promise.all(Array.from({ length: t.count }, (_, seat) => t.workers.at(-1)!.view(seat)));
        const endedReport = await t.post("report", 0, { note: "Test the end of the queued turn" }) as unknown as { path: string };
        const endedFile = join(endedReport.path, "journal.jsonl");
        const end = runCli(endedFile);
        expect(end).toMatchObject({ ok: true, replayed: 3, total: 3 });
        for (let seat = 0; seat < t.count; seat++) expect(end.views[String(seat)]).toEqual(final[seat]);
        const stopped = runCli(endedFile, 1);
        expect(stopped).toMatchObject({ ok: true, replayed: 1, total: 3 });
        for (let seat = 0; seat < t.count; seat++) expect(stopped.views[String(seat)]).toEqual(queued[seat]);
      } finally {
        if (oldScenarios === undefined) delete process.env.DUEL_SCENARIOS;
        else process.env.DUEL_SCENARIOS = oldScenarios;
        if (oldReports === undefined) delete process.env.DUEL_REPORT_DIR;
        else process.env.DUEL_REPORT_DIR = oldReports;
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s accepts a queue during a turn-end effect", async (format) => {
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_TURN_END)
e:SetOperation(function() Duel.SelectYesNo(0,30) end)
Duel.RegisterEffect(e,0)`]);
      const leaver = format === "tag" ? 1 : t.count - 1;
      await t.view();
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      const before = await t.view();
      expect(before).toMatchObject({ turn: 1, phase: "end" });
      expect(before.prompt?.kind).toBe("choice");
      const queued = await t.post("surrender", leaver);
      allIn(queued.engine!, t.count);
      const live = await t.view();
      await t.recover();
      expect(await t.view()).toEqual(live);
      const replayedQueue = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayedQueue.seats[0]).toEqual(live);
      await t.answer(0, { choice: "no" });
      const room = await t.post("view", leaver);
      const lost = Array.from({ length: t.count }, (_, seat) => format === "tag" ? teamOfSeat(format, seat) === 1 : seat === leaver);
      expect(states(room.engine!)).toEqual(lost.map((gone) => gone ? "out" : "in"));
      expect(room.role).toBe("spectator");
      if (format === "tag") expect(room.engine).toMatchObject({ turn: 1, result: { winnerSeat: 0 } });
      else expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      for (const seat of room.engine!.seats) if (!lost[seat.seat]) {
        expect(seat.hand).toHaveLength(1);
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
      }
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(room.engine!));
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s applies losses in queue order", async (format) => {
      const t = await table(mode, format);
      await t.view();
      const losers = format === "ffa3" ? [2, 1] : [3, 2];
      for (const seat of losers) await t.post("surrender", seat);
      allIn(await t.view(), t.count);
      await t.answer(0, { choice: "to_ep" });
      allIn(await t.view(), t.count);
      await t.answer(0, { choice: "no" });
      const final = await t.view();
      expect(states(final)).toEqual(Array.from({ length: t.count }, (_, seat) =>
        (format === "tag" ? teamOfSeat(format, seat) === 1 : losers.includes(seat)) ? "out" : "in"));
      if (format === "tag") expect(final.result?.winnerSeat).toBe(0);
      else {
        expect(final.eliminationOrder).toEqual(losers.map((seat) => [seat]));
        if (format === "ffa3") expect(final.result?.winnerSeat).toBe(0);
        else expect(final).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      }
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(final));
      expect(replayed.spectator.eliminationOrder).toEqual(final.eliminationOrder);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s last in the queue wins", async (format) => {
      const order = format === "ffa3" ? [2, 0, 1] : [3, 1, 0, 2];
      const winner = order.at(-1)!;
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetOperation(function() Duel.SelectYesNo(${winner},30) end)
Duel.RegisterEffect(e,0)`]);
      await t.view(winner);
      for (const seat of order) await t.post("surrender", seat);
      const final = await t.view(winner);
      expect(final.result?.winnerSeat).toBe(winner);
      expect(states(final)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === winner ? "in" : "out"));
      expect(final.eliminationOrder).toEqual(order.slice(0, -1).map((seat) => [seat]));
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(final));
      expect(replayed.spectator.eliminationOrder).toEqual(final.eliminationOrder);
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s keeps queue order during a turn-end prompt", async (format) => {
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_TURN_END)
e:SetOperation(function() Duel.SelectYesNo(0,30) end)
Duel.RegisterEffect(e,0)`]);
      await t.view();
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      const order = format === "ffa3" ? [2, 1] : [3, 2];
      for (const seat of order) await t.post("surrender", seat);
      await t.answer(0, { choice: "no" });
      const final = await t.view();
      expect(states(final)).toEqual(Array.from({ length: t.count }, (_, seat) =>
        (format === "tag" ? teamOfSeat(format, seat) === 1 : order.includes(seat)) ? "out" : "in"));
      if (format === "tag") expect(final.result?.winnerSeat).toBe(0);
      else expect(final.eliminationOrder).toEqual(order.map((seat) => [seat]));
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(final));
      expect(replayed.spectator.eliminationOrder).toEqual(final.eliminationOrder);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: a late queue follows the earlier queues", async () => {
      const t = await table(mode, "ffa4", false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_TURN_END)
e:SetOperation(function() Duel.SelectYesNo(0,30) end)
Duel.RegisterEffect(e,0)`]);
      await t.view();
      await t.post("surrender", 3);
      await t.post("surrender", 2);
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      await t.post("surrender", 1);
      await t.answer(0, { choice: "no" });
      const final = await t.view();
      expect(final.result?.winnerSeat).toBe(0);
      expect(states(final)).toEqual(["in", "out", "out", "out"]);
      expect(final.eliminationOrder).toEqual([[3], [2], [1]]);
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayed.spectator.eliminationOrder).toEqual(final.eliminationOrder);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: the first Tag team loses when its seat queues first", async () => {
      const t = await table(mode, "tag");
      await t.view();
      await t.post("surrender", 2);
      await t.post("surrender", 3);
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      const final = await t.view(1);
      expect(final.result?.winnerSeat).toBe(1);
      expect(states(final)).toEqual(["out", "in", "out", "in"]);
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(final));
    }, 60_000);
  });
}

async function passPrompt(t: Awaited<ReturnType<typeof table>>) {
  for (let seat = 0; seat < t.count; seat++) {
    const view = await t.workers.at(-1)!.view(seat);
    if (view.prompt) return t.answer(seat, chooseSurrenderedAnswer(view.prompt));
  }
  throw new Error("No prompt is open");
}

async function reachMain(t: Awaited<ReturnType<typeof table>>) {
  await t.view();
  for (let step = 0; step < 30; step++) {
    if ((await t.view()).prompt?.options.some((option) => option.id === "to_ep")) return;
    await passPrompt(t);
  }
  throw new Error("The Main Phase prompt did not open");
}

async function activateCard(t: Awaited<ReturnType<typeof table>>, code: number) {
  const before = await t.view();
  const option = before.prompt!.options.find((option) => option.card?.code === code && option.id.startsWith("activate:"));
  expect(option).toBeDefined();
  await t.answer(0, { choice: option!.id });
  for (let step = 0; step < 20; step++) {
    const view = await t.view();
    if (view.result || view.turn !== before.turn || view.prompt?.options.some((option) => option.id === "to_ep")) return;
    await passPrompt(t);
  }
  throw new Error("The card did not finish its effect");
}
