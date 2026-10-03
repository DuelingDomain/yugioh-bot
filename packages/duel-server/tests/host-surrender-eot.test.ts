import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, type DuelAnswer, type DuelEngineView, type DuelFormat, type DuelMode, type DuelRoom, type DuelReplay } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker, type GameOptions } from "../src/worker-client.js";
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
const END_PHASE_RECOVER = `local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetRange(LOCATION_MZONE)
e:SetCode(EVENT_PHASE_START+PHASE_END)
e:SetOperation(function() Duel.Recover(1,321,REASON_EFFECT) end)
c:RegisterEffect(e)`;
class TestWorker extends GameWorker {
  holdViews = false;
  failCreate = false;
  private readonly heldViews: Array<() => void> = [];

  override async create(options: GameOptions) {
    if (this.failCreate) throw new Error("Replay worker unavailable");
    return super.create(options);
  }

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

async function table(mode: DuelMode, format: DuelFormat, chain = false, extraScripts: string[] = [], queueBlockedMs = 30_000, drawPerTurn = 0) {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const count = seatCountFor(format);
  const players = Array.from({ length: count }, (_, seat) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)",
  ).run("g", `u${seat}`, `P${seat}`).lastInsertRowid));
  const service = createDuelService(db);
  const session = service.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Immediate surrender", mode, format,
    settings: { banlist: "none", turnSeconds: 60, startingHand: 0, drawPerTurn, shuffleDeck: false } });
  for (const player of players.slice(1)) service.takeSeat(session.slug, "g", player);
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
  let failReplays = false;
  const makeHost = () => {
    const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000,
      queueBlockedMs, createWorker: () => { const worker = new TestWorker(); worker.failCreate = failReplays; workers.push(worker); return worker; } });
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
    return { kind: "journal", label: "Immediate surrender", mode, format, masterRule: state.session.masterRule,
      decks: state.decks, seed: state.seed!, settings: state.session.settings, firstTurnDraw: state.setup!.firstTurnDraw,
      startupScripts: state.setup!.startupScripts!.map((content, index) => ({ name: `startup-${index}.lua`, content })),
      commands: state.commands.map(({ seat, command }) => ({ seat, ...command })) };
  };
  return { db, service, session, count, players, post, view, answer, source, workers,
    failReplays: () => { failReplays = true; },
    recover: async () => { await host.close(); host = makeHost(); return view(); } };
}

const states = (view: DuelEngineView) => view.seats.map((seat) => seat.eliminated ? "out" : seat.pendingElimination ? "pending" : "in");
// Only these installed cores use the old turn n+1 attack window. Proof cores and
// all other builds must give the last living duelist a Battle Phase on its first turn.
const LEGACY_FIRST_BATTLE_HASHES = new Set([
  "896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e",
  "f1f8adaeaff21328970ffe894bf70cd86cc3afa18731a8aae4a397206824e2cb",
]);
function legacyFirstBattleWindow(mode: DuelMode): boolean {
  const file = mode === "domain" ? "ocgcore.multi-domain.wasm" : "ocgcore.multi.wasm";
  return LEGACY_FIRST_BATTLE_HASHES.has(createHash("sha256").update(readFileSync(join(DATA, file))).digest("hex"));
}

for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`${mode} host immediate surrender`, [needs.cards(DATA),
    mode === "domain" ? needs.domainMulti(DATA, `${DATA}/ocgcore.multi-domain.wasm`) : needs.installedMulti(DATA)], () => {
    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s another-turn surrender removes the seat before any answer", async (format) => {
      const t = await table(mode, format);
      const before = await t.view();
      const leaver = t.count - 1;
      const room = await t.post("surrender", leaver);
      expect(states(room.engine!)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === leaver ? "out" : "in"));
      expect(room).toMatchObject({ role: "spectator", mySeat: null, myDeck: null });
      expect(await t.view()).toMatchObject({ turn: before.turn, turnSeat: 0, phase: "main1", result: null });
      expect((await t.view()).prompt?.id).toBe(before.prompt?.id);
      expect(t.source().commands.map((command) => command.promptId)).toEqual(["eliminate:0"]);
      expect(room.engine!.seats[leaver]!.monsters.filter(Boolean)).toHaveLength(0);
      expect(room.engine!.seats.every((seat) => !seat.pendingElimination)).toBe(true);
      const live = await t.view();
      await t.recover();
      expect(await t.view()).toEqual(live);
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[0]).toEqual(live);
      for (let seat = 0; seat < leaver; seat++) {
        await reachMain(t, seat);
        await t.answer(seat, { choice: "to_ep" });
      }
      await reachMain(t);
      expect(await t.view()).toMatchObject({ turn: t.count, turnSeat: 0 });
      expect((await t.view()).log.some((entry) => entry.text === `Turn ${t.count} — Player ${leaver + 1}`)).toBe(false);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s another-turn surrender preserves a living required choice", async (format) => {
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetCountLimit(1)
e:SetOperation(function() Duel.SelectOption(0,30,31) end)
Duel.RegisterEffect(e,0)`]);
      const before = await t.view();
      expect(before.prompt?.options.map((option) => option.id)).toEqual(["opt:0", "opt:1"]);
      const leaver = t.count - 1;
      await t.post("surrender", leaver);
      const after = await t.view();
      expect(after.prompt).toEqual(before.prompt);
      expect(states(after)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === leaver ? "out" : "in"));
      await t.recover();
      expect(await t.view()).toEqual(after);
      await t.answer(0, { choice: "opt:1" });
      expect(await t.view()).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1", result: null });
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s an interrupted chain loss keeps the player role until it lands", async (format) => {
      const t = await table(mode, format, true);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 5 && !(await t.view()).chain?.length; step++) await passPrompt(t);
      await t.post("surrender", 0);
      expect((await t.view()).seats[0]!.pendingElimination).toBe(true);
      t.service.interrupt(t.session.slug, "g", "Test interrupted chain");
      await t.recover();
      expect(await t.post("view", 0)).toMatchObject({ role: "player", mySeat: 0, engine: null });
      expect(await t.post("replay", 0)).toMatchObject({ role: "player", mySeat: 0 });
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s resolves a chain between two other seats before the loss", async (format) => {
      const t = await table(mode, format, true, [`Debug.AddCard(83968380,1,1,LOCATION_SZONE,1,POS_FACEDOWN)`]);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 10; step++) {
        const response = await t.view(1);
        const jar = response.prompt?.options.find((option) => option.card?.code === 83968380);
        if (jar) { await t.answer(1, { choice: jar.id }); break; }
        await passPrompt(t);
      }
      for (let step = 0; step < 10 && (await t.view()).chain!.length < 2; step++) await passPrompt(t);
      expect((await t.view()).chain?.map((link) => link.seat)).toEqual([0, 1]);
      const leaver = t.count - 1;
      const before = await t.view();
      await t.post("surrender", leaver);
      const pending = await t.view();
      expect(states(pending)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === leaver ? "pending" : "in"));
      expect(pending.seats[leaver]!.monsters.filter(Boolean)).toHaveLength(1);
      expect((await t.post("view", leaver)).role).toBe("player");
      expect(t.service.privateState(t.session.slug, "g").clock?.activeSeat).not.toBe(leaver);
      await t.recover();
      expect(await t.view()).toEqual(pending);
      await t.post("respond", leaver, { command: { revision: pending.revision, promptId: "old", answer: { choice: "chain:pass" } } }, 409);
      for (let step = 0; step < 25 && (await t.view()).chain?.length; step++) {
        const during = await t.view();
        expect(during.seats[leaver]!.eliminated).toBe(false);
        expect(during.seats[leaver]!.pendingElimination).toBe(true);
        await passPrompt(t);
      }
      const final = await t.view();
      expect(final).toMatchObject({ turn: before.turn, turnSeat: 0, phase: "main1", result: null });
      expect(final.chain).toEqual([]);
      expect(states(final)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === leaver ? "out" : "in"));
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[0]).toEqual(final);
      // Living seats can still have post-chain response choices. The loss must
      // already be visible before those choices, and before the next action.
      await reachMain(t);
      expect(states(await t.view())).toEqual(states(final));
      expect(final.seats[0]!.hand).toHaveLength(2);
      expect(final.seats[1]!.hand).toHaveLength(2);
      expect(final.seats[leaver]!.monsters.filter(Boolean)).toHaveLength(0);
      expect(final.seats.every((seat) => !seat.pendingElimination)).toBe(true);
      expect((await t.post("view", leaver)).role).toBe("spectator");
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s the last living player wins without an answer", async (format) => {
      const t = await table(mode, format);
      const before = await t.view();
      const losers = Array.from({ length: t.count - 1 }, (_, index) => t.count - 1 - index);
      for (const [index, seat] of losers.entries()) {
        const room = await t.post("surrender", seat);
        expect(room.session.status).toBe(index === losers.length - 1 ? "completed" : "active");
        expect(states(room.engine!)).toEqual(Array.from({ length: t.count }, (_, member) => losers.slice(0, index + 1).includes(member) ? "out" : "in"));
      }
      const final = await t.view();
      expect(final).toMatchObject({ turn: before.turn, turnSeat: 0, result: { winnerSeat: 0, reason: "Surrender" }, prompt: null });
      expect(final.eliminationOrder).toEqual(losers.map((seat) => [seat]));
      expect(final.log.filter((line) => line.text.includes("is eliminated")).map((line) => line.text))
        .toEqual(losers.map((seat) => `Player ${seat + 1} is eliminated (Surrender)`));
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).spectator.eliminationOrder).toEqual(final.eliminationOrder);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s the last living player wins after the whole chain", async (format) => {
      const t = await table(mode, format, true, [`Debug.AddCard(83968380,1,1,LOCATION_SZONE,1,POS_FACEDOWN)
local c=Duel.GetFieldCard(0,LOCATION_HAND,0)
for _,e in ipairs({c:GetCardEffect(EVENT_FREE_CHAIN)}) do
  if (e:GetType()&EFFECT_TYPE_ACTIVATE)~=0 then
    e:SetOperation(function()
      Duel.SelectOption(0,30,31)
      Duel.Draw(0,2,REASON_EFFECT)
    end)
  end
end`]);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 10; step++) {
        const jar = (await t.view(1)).prompt?.options.find((option) => option.card?.code === 83968380);
        if (jar) { await t.answer(1, { choice: jar.id }); break; }
        await passPrompt(t);
      }
      for (let step = 0; step < 10 && (await t.view()).chain!.length < 2; step++) await passPrompt(t);
      expect((await t.view()).chain?.map((link) => link.seat)).toEqual([0, 1]);
      // All seats except the turn player surrender. Seat 1's unresolved link
      // resolves normally; the living turn player's lower link must still draw two.
      for (let seat = t.count - 1; seat >= 1; seat--) await t.post("surrender", seat);
      const pending = await t.view();
      expect(pending.result).toBeNull();
      expect(states(pending)).toEqual(["in", ...Array(t.count - 1).fill("pending")]);
      for (let step = 0; step < 25 && !(await t.view()).result; step++) await passPrompt(t);
      const final = await t.view();
      expect(final).toMatchObject({ turn: 1, turnSeat: 0, chain: [], prompt: null,
        result: { winnerSeat: 0, reason: "Surrender" } });
      expect(final.seats[0]!.hand).toHaveLength(2);
      expect(final.log.some((line) => line.text.startsWith("Player 2 drew 1"))).toBe(true);
      expect(states(final)).toEqual(["in", ...Array(t.count - 1).fill("out")]);
      expect(final.eliminationOrder).toEqual([Array.from({ length: t.count - 1 }, (_, index) => index + 1)]);
      // The raw core names a team also in FFA; the host's final snapshot names the winner seat.
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[0])
        .toEqual({ ...final, result: { ...final.result, winnerTeam: 0 } });
      await t.recover();
      expect(await t.view()).toEqual(final);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s loss precedes a required post-chain choice", async (format) => {
      const t = await table(mode, format, true, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CHAIN_END)
e:SetCountLimit(1)
e:SetOperation(function() Duel.SelectOption(0,30,31) end)
Duel.RegisterEffect(e,0)`]);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 10 && !(await t.view()).chain?.length; step++) await passPrompt(t);
      expect((await t.view()).chain).toHaveLength(1);
      const leaver = t.count - 1;
      await t.post("surrender", leaver);
      for (let step = 0; step < 25 && !(await t.view()).prompt?.options.some((option) => option.id === "opt:0"); step++) await passPrompt(t);
      const after = await t.view();
      expect(after.chain).toEqual([]);
      expect(after.seats[leaver]!.eliminated).toBe(true);
      expect(after.prompt?.options.map((option) => option.id)).toEqual(["opt:0", "opt:1"]);
      await t.answer(0, { choice: "opt:1" });
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s surrender does not settle an unfinished living LP operation", async (format) => {
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetCountLimit(1)
e:SetOperation(function()
  Duel.SetLP(1,0)
  Duel.SelectOption(0,30,31)
  Duel.SetLP(1,8000)
end)
Duel.RegisterEffect(e,0)`]);
      const before = await t.view();
      expect(before.seats[1]!.lp).toBe(0);
      const leaver = t.count - 1;
      await t.post("surrender", leaver);
      const after = await t.view();
      expect(after.prompt).toEqual(before.prompt);
      expect(after.result).toBeNull();
      expect(states(after)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === leaver ? "out" : "in"));
      await t.answer(0, { choice: "opt:1" });
      expect((await t.view()).seats[1]).toMatchObject({ lp: 8000, eliminated: false });
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: refuses a core without immediate surrender support before any mutation", async () => {
      const t = await table(mode, "ffa4", false, ["Debug.SurrenderDuelist=nil"]);
      const before = await t.view();
      await t.post("surrender", 3, {}, 409);
      expect(await t.view()).toEqual(before);
      expect(t.source().commands).toEqual([]);
      expect(t.service.privateState(t.session.slug, "g").setup?.surrenderedSeats).toBeUndefined();
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: immediate surrender does not advance a pending time-limit loss", async () => {
      const t = await table(mode, "ffa4");
      const before = await t.view();
      const worker = t.workers.at(-1)!;
      await worker.eliminate(1, 3);
      expect((await worker.view(0)).seats[1]!.pendingElimination).toBe(true);
      await worker.eliminate(3, 0);
      const after = await worker.view(0);
      expect(after.prompt).toEqual(before.prompt);
      expect(states(after)).toEqual(["in", "pending", "in", "out"]);
    }, 60_000);

    it.each([0, 3])("R-COMMON-SURRENDER-EOT: Tag seat %s ends an open chain at once", async (leaver) => {
      const t = await table(mode, "tag", true);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 5 && !(await t.view()).chain?.length; step++) await passPrompt(t);
      const before = await t.view(1);
      expect(before.chain).toHaveLength(1);
      const commands = t.source().commands;
      const room = await t.post("surrender", leaver);
      expect(room.session).toMatchObject({ status: "completed", winnerSeat: leaver === 0 ? 1 : 0, resultReason: "Surrender" });
      expect(room.engine).toMatchObject({ turn: before.turn, phase: before.phase, prompt: null, chain: before.chain });
      expect(room.engine!.seats.every((seat) => !seat.pendingElimination)).toBe(true);
      expect(t.source().commands).toEqual(commands);
      await t.recover();
      expect((await t.post("view", leaver)).engine).toEqual(room.engine);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s auto-answers the leaver's required choice in a resolving link", async (format) => {
      const t = await table(mode, format, true, [`local c=Duel.GetFieldCard(0,LOCATION_HAND,0)
for _,e in ipairs({c:GetCardEffect(EVENT_FREE_CHAIN)}) do
  if (e:GetType()&EFFECT_TYPE_ACTIVATE)~=0 then
    e:SetOperation(function()
      Duel.SelectOption(0,30,31)
      Duel.Recover(1,321,REASON_EFFECT)
    end)
  end
end`]);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 20; step++) {
        const v = await t.view();
        if (v.chain?.length === 1 && v.prompt?.options.some((option) => option.id === "opt:0")) break;
        await passPrompt(t);
      }
      const before = await t.view();
      expect(before.chain).toHaveLength(1);
      expect(before.prompt?.options.map((option) => option.id)).toEqual(["opt:0", "opt:1"]);
      const room = await t.post("surrender", 0);
      expect(room).toMatchObject({ role: "spectator", mySeat: null });
      expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, chain: [], result: null });
      expect(states(room.engine!)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === 0 ? "out" : "in"));
      // The link already started. Its effect finishes after the deterministic
      // required choice, even though a loss was flagged during that choice.
      expect(room.engine!.seats[1]!.lp).toBe(before.seats[1]!.lp + 321);
      expect(t.source().commands.at(-1)?.promptId).toBe("eliminate:0");
      const live = await t.view(1);
      await t.recover();
      expect(await t.view(1)).toEqual(live);
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(live);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s cancels a leaver's activation before its first Chain Link", async (format) => {
      const t = await table(mode, format, true);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      const before = await t.view();
      expect(before.chain).toEqual([]);
      expect(before.prompt?.kind).toBe("places");
      const room = await t.post("surrender", 0);
      expect(room).toMatchObject({ role: "spectator", mySeat: null,
        engine: { turn: 2, turnSeat: 1, chain: [], result: null } });
      expect(room.engine!.seats[0]!.spells.filter(Boolean)).toHaveLength(0);
      expect(room.engine!.log.some((line) => line.text.includes("Pot of Greed is activating") || line.text.includes("drew 2"))).toBe(false);
      const live = await t.view(1);
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(live);
      await t.recover();
      expect(await t.view(1)).toEqual(live);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s cancels a leaver's summon while its zone choice is open", async (format) => {
      const t = await table(mode, format);
      await reachMain(t);
      const summon = (await t.view()).prompt!.options.find((option) => option.id.startsWith("summon:"));
      expect(summon).toBeDefined();
      await t.answer(0, { choice: summon!.id });
      const before = await t.view();
      expect(before.chain).toEqual([]);
      expect(before.prompt?.kind).toBe("places");
      const room = await t.post("surrender", 0);
      expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, chain: [], result: null });
      expect(room.engine!.seats[0]!.monsters.filter(Boolean)).toHaveLength(0);
      const live = await t.view(1);
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(live);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s preserves a living opponent pick and refuses its removed seat", async (format) => {
      const t = await table(mode, format, true, [`local c=Duel.GetFieldCard(0,LOCATION_HAND,0)
for _,e in ipairs({c:GetCardEffect(EVENT_FREE_CHAIN)}) do
  if (e:GetType()&EFFECT_TYPE_ACTIVATE)~=0 then
    e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.GetLP(1)>0 end
      Duel.SetTargetPlayer(tp)
      Duel.SetTargetParam(2)
      Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,2)
    end)
  end
end`]);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      const before = await t.view();
      expect(before.chain).toEqual([]);
      expect(before.prompt?.context?.type).toBe("opponent");
      await t.post("surrender", 1);
      const after = await t.view();
      expect(after.prompt).toEqual(before.prompt);
      expect(after.seats[1]!.eliminated).toBe(true);
      await t.post("respond", 0, { command: { promptId: after.prompt!.id, revision: after.revision, answer: { choice: "opt:0" } } }, 400);
      expect((await t.view()).prompt).toEqual(after.prompt);
      await t.answer(0, { choice: "opt:1" });
      await reachMain(t);
      expect((await t.view()).seats[0]!.hand).toHaveLength(2);
    }, 60_000);

    it.each([
      ["ffa3", "group"], ["ffa4", "group"], ["ffa3", "step"], ["ffa4", "step"],
    ] as const)("R-COMMON-SURRENDER-EOT: %s cancels a no-chain effect Special Summon (%s) at its zone choice", async (format, api) => {
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetCountLimit(1)
e:SetCondition(function() return Duel.GetTurnPlayer()==0 end)
e:SetOperation(function()
  local c=Duel.GetFieldCard(0,LOCATION_HAND,0)
  ${api === "group"
    ? 'assert(Duel.SpecialSummon(c,0,0,0,false,false,POS_FACEUP_ATTACK)==0,"Cancelled group summon must return zero")'
    : 'assert(not Duel.SpecialSummonStep(c,0,0,0,false,false,POS_FACEUP_ATTACK),"Cancelled summon step must return false")\n  assert(Duel.SpecialSummonComplete()==0,"Cancelled summon must not complete")'}
  assert(c:GetLocation()==0,"Cancelled card must stay removed")
  assert(not c:IsStatus(STATUS_SPSUMMON_STEP),"Cancelled summon must clear its step status")
end)
Duel.RegisterEffect(e,0)`]);
      const before = await t.view();
      expect(before.chain).toEqual([]);
      expect(before.prompt?.kind).toBe("places");
      const room = await t.post("surrender", 0);
      expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, chain: [], result: null });
      expect(room.engine!.seats[0]!.monsters.filter(Boolean)).toHaveLength(0);
      expect(room.engine!.log.some((line) => line.text.includes("Mystical Elf") && line.text.includes("Special Summon"))).toBe(false);
      const live = await t.view(1);
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(live);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s cancels a Gemini summon cost without blocking the next player's summon", async (format) => {
      const t = await table(mode, format, false, [`local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_SINGLE)
e:SetCode(EFFECT_GEMINI_SUMMONABLE)
c:RegisterEffect(e)
local cost=Effect.CreateEffect(c)
cost:SetType(EFFECT_TYPE_SINGLE)
cost:SetCode(EFFECT_SUMMON_COST)
cost:SetOperation(function() Duel.SelectOption(0,30,31) end)
c:RegisterEffect(cost)`]);
      await reachMain(t);
      const gemini = (await t.view()).prompt!.options.find((option) => option.card?.code === 32452818 && option.id.startsWith("summon:"));
      expect(gemini).toBeDefined();
      await t.answer(0, { choice: gemini!.id });
      expect((await t.view()).prompt?.options.map((option) => option.id)).toEqual(["opt:0", "opt:1"]);
      expect((await t.view()).chain).toEqual([]);
      await t.post("surrender", 0);
      await reachMain(t, 1);
      const summon = (await t.view(1)).prompt!.options.find((option) => option.card?.code === 15025844 && option.id.startsWith("summon:"));
      expect(summon).toBeDefined();
      await t.answer(1, { choice: summon!.id });
      await reachMain(t, 1);
      const live = await t.view(1);
      expect(live.seats[1]!.monsters.filter(Boolean).map((card) => card!.code)).toContain(15025844);
      expect(live.seats[0]!.monsters.filter(Boolean)).toHaveLength(0);
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(live);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s cancels the leaver's procedure pick before the next player's Special Summon", async (format) => {
      const t = await table(mode, format, false, [`Debug.AddCard(55063751,0,0,LOCATION_HAND,1,POS_FACEDOWN)
local c=Duel.GetFieldCard(1,LOCATION_HAND,0)
for i=1,2 do
  local e=Effect.CreateEffect(c)
  e:SetDescription(30+i)
  e:SetType(EFFECT_TYPE_FIELD)
  e:SetCode(EFFECT_SPSUMMON_PROC)
  e:SetProperty(EFFECT_FLAG_UNCOPYABLE)
  e:SetRange(LOCATION_HAND)
  e:SetCondition(function(e,c) return true end)
  c:RegisterEffect(e)
end`]);
      await reachMain(t);
      const kaiju = (await t.view()).prompt!.options.find((option) => option.card?.code === 55063751 && option.id.startsWith("spsummon:"));
      expect(kaiju).toBeDefined();
      await t.answer(0, { choice: kaiju!.id });
      expect((await t.view()).prompt?.context?.type).toBe("opponent");
      await t.post("surrender", 0);
      await reachMain(t, 1);
      const summon = (await t.view(1)).prompt!.options.find((option) => option.card?.code === 15025844 && option.id.startsWith("spsummon:"));
      expect(summon).toBeDefined();
      await t.answer(1, { choice: summon!.id });
      expect((await t.view(1)).prompt?.options.map((option) => option.id)).toEqual(["opt:0", "opt:1"]);
      await t.answer(1, { choice: "opt:1" });
      await reachMain(t, 1);
      const live = await t.view(1);
      expect(live.seats[1]!.monsters.filter(Boolean).map((card) => card!.code)).toContain(15025844);
      expect(live.seats[0]!.monsters.filter(Boolean)).toHaveLength(0);
      expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(live);
    }, 60_000);

    for (const [actor, target, closes] of [[0, 1, true], [1, 0, true], [1, 1, false]] as const) {
      it.each(["ffa3", "ffa4"] as const)(`R-COMMON-SURRENDER-EOT: %s turn-player loss ${closes ? "closes an involved" : "keeps a living-only"} response window (actor ${actor}, target ${target})`, async (format) => {
        const t = await table(mode, format, true, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetCountLimit(1)
e:SetOperation(function() local c=Duel.GetFieldCard(${target},LOCATION_MZONE,0) if Duel.GetTurnCount()==1 and c then Duel.Destroy(c,REASON_EFFECT) end end)
Duel.RegisterEffect(e,${actor})`]);
        const responder = t.count - 1;
        for (let step = 0; step < 25; step++) {
          const v = await t.view(responder);
          if (v.phase === "main1" && !v.seats[target]!.monsters.some(Boolean) && v.prompt?.context?.type === "chain") break;
          await passPrompt(t);
        }
        const before = await t.view(responder);
        expect(before).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1", chain: [] });
        expect(before.seats[target]!.monsters.filter(Boolean)).toHaveLength(0);
        expect(before.prompt?.context?.type).toBe("chain");
        await t.post("surrender", 0);
        const after = await t.view(responder);
        expect(states(after)).toEqual(["out", ...Array(t.count - 1).fill("in")]);
        if (closes) {
          expect(after.prompt).toBeNull();
          expect((await t.view(1)).prompt).toMatchObject({
            kind: "choice", seat: 1, cancelable: true, context: { type: "chain", forced: false },
            options: [{ id: "card:0", card: { code: 60082869 }, controller: 1, location: 8, sequence: 0 }],
          });
          await reachMain(t, 1);
        } else {
          expect(after).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1", chain: [] });
          expect(after.prompt).toEqual(before.prompt);
          await t.recover();
          expect(await t.view(responder)).toEqual(after);
          expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[responder]).toEqual(after);
          await t.answer(responder, chooseSurrenderedAnswer(after.prompt!));
          await reachMain(t, 1);
        }
        expect(await t.view(1)).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      }, 60_000);
    }

    for (const owner of [0, 1]) for (const triggers of [1, 2]) {
      it.each(["ffa3", "ffa4"] as const)(`R-COMMON-SURRENDER-EOT: %s single-card response keeps its event (owner ${owner}, triggers ${triggers})`, async (format) => {
        const t = await table(mode, format, true, [`local c=Debug.AddCard(15025844,${owner},1,LOCATION_MZONE,1,POS_FACEUP_ATTACK)
local holder=Effect.CreateEffect(c)
holder:SetType(EFFECT_TYPE_SINGLE)
holder:SetCode(EFFECT_SET_CONTROL)
holder:SetValue(1)
c:RegisterEffect(holder)
c:EnableCounterPermit(0x1001)
for i=1,${triggers} do
 local trigger=Effect.CreateEffect(c)
 trigger:SetType(EFFECT_TYPE_SINGLE|EFFECT_TYPE_TRIGGER_O)
 trigger:SetCode(EVENT_ADD_COUNTER+0x1001)
 trigger:SetRange(LOCATION_MZONE)
 trigger:SetOperation(function() end)
 c:RegisterEffect(trigger)
end
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_STANDBY)
e:SetCountLimit(1)
e:SetOperation(function() if Duel.GetTurnCount()==1 then c:AddCounter(0x1001,1) end end)
Duel.RegisterEffect(e,1)`]);
        for (let step = 0; step < 50; step++) {
          const v = await t.view(1);
          if (v.phase === "standby" && v.seats[1]!.monsters.some((c) => c?.counters?.some((counter) => counter.count === 1)) && v.prompt && (v.prompt.options.some((o) => o.id === "no") || v.prompt.context?.type === "chain" && v.prompt.options.some((o) => o.card?.code === 15025844))) break;
          await passPrompt(t);
        }
        const before = await t.view(1);
        expect(before).toMatchObject({ turn: 1, turnSeat: 0, phase: "standby", chain: [] });
        expect(before.prompt).not.toBeNull();
        if (triggers === 1) expect(before.prompt!.options.map((o) => o.id)).toContain("no");
        else expect(before.prompt).toMatchObject({ context: { type: "chain", forced: false }, cancelable: true });
        await t.post("surrender", 0);
        const after = await t.view(1);
        expect(states(after)).toEqual(["out", ...Array(t.count - 1).fill("in")]);
        if (owner === 0) expect(after.prompt).toMatchObject({
          kind: "choice", seat: 1, cancelable: true, context: { type: "chain", forced: false },
          options: [{ id: "card:0", card: { code: 60082869 }, controller: 1, location: 8, sequence: 0 }],
        });
        else {
          expect(after.prompt).toEqual(before.prompt);
          await t.recover();
          expect(await t.view(1)).toEqual(after);
          expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(after);
          await t.answer(1, chooseSurrenderedAnswer(after.prompt!));
          // Passing the trigger still leaves the same living action's later quick response open.
          for (let step = 0; step < t.count; step++) {
            const next = await t.view(t.count - 1);
            expect(next).toMatchObject({ turn: 1, turnSeat: 0, chain: [] });
            if (next.prompt?.context?.type === "chain") break;
            await passPrompt(t);
          }
          expect((await t.view(t.count - 1)).prompt?.context?.type).toBe("chain");
        }
        await reachMain(t, 1);
        expect(await t.view(1)).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      }, 60_000);
    }

    for (const action of ["destroy borrowed", "move borrowed", "reset living trap", "shuffle living sets"] as const) {
      it.each(["ffa3", "ffa4"] as const)(`R-COMMON-SURRENDER-EOT: %s response participants follow the action (${action})`, async (format) => {
        const closes = action === "destroy borrowed" || action === "move borrowed";
        const script = action === "reset living trap" ? `local c=Debug.AddCard(28649820,1,1,LOCATION_MZONE,1,POS_FACEUP_DEFENSE)
local t=Effect.CreateEffect(c)
t:SetType(EFFECT_TYPE_SINGLE)
t:SetCode(EFFECT_CHANGE_TYPE)
t:SetValue(TYPE_MONSTER|TYPE_TRAP|TYPE_EFFECT|TYPE_TRAPMONSTER)
t:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_TURN_SET)
c:RegisterEffect(t)` : action === "shuffle living sets" ? `local c=Debug.AddCard(60082869,2,0,LOCATION_SZONE,1,POS_FACEDOWN)
local d=Debug.AddCard(60082869,2,1,LOCATION_SZONE,2,POS_FACEDOWN)
local start=Effect.GlobalEffect()
start:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
start:SetCode(EVENT_STARTUP)
start:SetOperation(function() local p=Duel.MPActionSeat(1) Duel.MoveToField(c,p,p,LOCATION_SZONE,POS_FACEDOWN,true) end)
Duel.RegisterEffect(start,1)` : `local c=Debug.AddCard(15025844,2,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK)
local control=0
local holder=Effect.CreateEffect(c)
holder:SetType(EFFECT_TYPE_SINGLE)
holder:SetCode(EFFECT_SET_CONTROL)
holder:SetValue(function() return control end)
c:RegisterEffect(holder)`;
        const operation = action === "destroy borrowed" ? "Duel.Destroy(c,REASON_EFFECT)"
          : action === "move borrowed" ? "control=1 local p=Duel.MPActionSeat(1) Duel.MoveToField(c,p,p,LOCATION_MZONE,POS_FACEUP_ATTACK,true)"
          : action === "reset living trap" ? "Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)"
          : "Duel.ShuffleSetCard(Group.FromCards(c,d))";
        const t = await table(mode, format, true, [`${script}
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetCountLimit(1)
e:SetOperation(function() if Duel.GetTurnCount()==1 then ${operation} end end)
Duel.RegisterEffect(e,1)`]);
        const responder = t.count - 1;
        if (closes) expect((await t.view(responder)).seats[0]!.monsters.filter(Boolean)).toHaveLength(2);
        const occurred = (v: DuelEngineView) => action === "destroy borrowed" ? v.seats[2]!.graveyard.length > 0
          : action === "move borrowed" ? v.seats[0]!.monsters.filter(Boolean).length === 1
            && v.seats[1]!.monsters.filter(Boolean).length + v.seats[2]!.monsters.filter(Boolean).length === 3
          : v.seats[1]!.spells.filter(Boolean).length === (action === "reset living trap" ? 2 : 3);
        for (let step = 0; step < 50; step++) {
          const v = await t.view(responder);
          if (v.phase === "main1" && occurred(v) && v.prompt?.context?.type === "chain") break;
          await passPrompt(t);
        }
        const before = await t.view(responder);
        expect(before).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1", chain: [] });
        expect(occurred(before)).toBe(true);
        expect(before.prompt?.context?.type).toBe("chain");
        await t.post("surrender", 0);
        const after = await t.view(responder);
        expect(states(after)).toEqual(["out", ...Array(t.count - 1).fill("in")]);
        if (closes) {
          expect(after.prompt).toBeNull();
          expect((await t.view(1)).prompt).toMatchObject({
            kind: "choice", seat: 1, cancelable: true, context: { type: "chain", forced: false },
            options: [{ id: "card:0", card: { code: 60082869 }, controller: 1, location: 8, sequence: 0 }],
          });
        }
        else {
          expect(after.prompt).toEqual(before.prompt);
          await t.recover();
          expect(await t.view(responder)).toEqual(after);
          expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[responder]).toEqual(after);
          await t.answer(responder, chooseSurrenderedAnswer(after.prompt!));
        }
        await reachMain(t, 1);
        expect(await t.view(1)).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      }, 60_000);
    }

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s closes a living optional destroyed trigger after the leaver's chain resolves", async (format) => {
      // First prove that the same destroyed-card trigger opens and resolves without surrender.
      for (const surrender of [false, true]) {
        const t = await table(mode, format, true, [`local victim=Duel.GetFieldCard(1,LOCATION_MZONE,0)
local trigger=Effect.CreateEffect(victim)
trigger:SetType(EFFECT_TYPE_SINGLE|EFFECT_TYPE_TRIGGER_O)
trigger:SetCode(EVENT_DESTROYED)
trigger:SetProperty(EFFECT_FLAG_DELAY)
trigger:SetOperation(function() Duel.Recover(Duel.MPActionSeat(1),321,REASON_EFFECT) end)
victim:RegisterEffect(trigger)
local source=Duel.GetFieldCard(0,LOCATION_HAND,0)
for _,e in ipairs({source:GetCardEffect(EVENT_FREE_CHAIN)}) do
  if (e:GetType()&EFFECT_TYPE_ACTIVATE)~=0 then
    e:SetOperation(function() Duel.Destroy(victim,REASON_EFFECT) end)
  end
end`]);
        await reachMain(t);
        const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
        expect(activate).toBeDefined();
        await t.answer(0, { choice: activate!.id });
        for (let step = 0; step < 10 && !(await t.view()).chain?.length; step++) await passPrompt(t);
        const before = await t.view(1);
        expect(before.chain?.map((link) => link.seat)).toEqual([0]);
        expect(before.seats[1]!.monsters.filter(Boolean).map((card) => card!.code)).toContain(32452818);
        if (surrender) {
          await t.post("surrender", 0);
          const pending = await t.view(1);
          expect(states(pending)).toEqual(["pending", ...Array(t.count - 1).fill("in")]);
          expect(pending.chain?.map((link) => link.seat)).toEqual([0]);
          expect(pending.seats[1]!.monsters.filter(Boolean).map((card) => card!.code)).toContain(32452818);
        }
        // Stop when this chain ends. Never pass the later trigger to make it close.
        for (let step = 0; step < 25 && (await t.view()).chain?.length; step++) await passPrompt(t);
        const after = await t.view(1);
        expect(after.chain).toEqual([]);
        expect(after.seats[1]!.monsters.filter(Boolean)).toHaveLength(0);
        expect(after.seats[1]!.graveyard.map((card) => card.code)).toContain(32452818);
        expect(after.seats[1]!.lp).toBe(before.seats[1]!.lp);
        if (surrender) {
          expect(states(after)).toEqual(["out", ...Array(t.count - 1).fill("in")]);
          expect(after).toMatchObject({ turn: 2, turnSeat: 1, result: null });
          expect(after.prompt).toMatchObject({
            kind: "choice", seat: 1, cancelable: true, context: { type: "chain", forced: false },
            options: [{ id: "card:0", card: { code: 60082869 }, controller: 1, location: 8, sequence: 0 }],
          });
          await t.recover();
          expect(await t.view(1)).toEqual(after);
          expect((await replaySource(t.source(), DATA, t.source().commands.length)).seats[1]).toEqual(after);
        } else {
          expect(states(after)).toEqual(Array(t.count).fill("in"));
          expect(after).toMatchObject({ turn: 1, turnSeat: 0, result: null });
          expect(after.prompt).toMatchObject({ kind: "choice", seat: 1, source: { code: 32452818 },
            options: [{ id: "yes" }, { id: "no" }] });
          await t.answer(1, { choice: "yes" });
          await reachMain(t);
          expect((await t.view(1)).seats[1]!.lp).toBe(before.seats[1]!.lp + 321);
        }
      }
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s own-turn chain resolves before the next living turn", async (format) => {
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
      const pendingRoom = await t.post("surrender", 0);
      expect(pendingRoom.session.status).toBe("active");
      expect(states(pendingRoom.engine!)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === 0 ? "pending" : "in"));
      expect((await t.view(1)).prompt?.id).toBe(before.prompt?.id);
      expect(t.source().commands.at(-1)?.promptId).toBe("eliminate:0");
      const live = await t.view(1);
      await t.recover();
      expect(await t.view(1)).toEqual(live);
      for (let step = 0; step < 20 && (await t.view(1)).chain?.length; step++) await passPrompt(t);
      const final = await t.view(1);
      expect(states(final)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === 0 ? "out" : "in"));
      expect(final).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      const deckCount = t.service.privateState(t.session.slug, "g").decks[0]!.main.length;
      // Pot of Greed resolves normally before its owner leaves.
      expect(final.log.some((line) => line.text.includes("drew 2"))).toBe(true);
      for (const seat of final.seats) if (!seat.eliminated) {
        expect(seat.hand).toHaveLength(1);
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
        expect(seat.deckCount).toBe(deckCount);
      }
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(final));
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s normal turn end fires the End Phase Recover effect", async (format) => {
      const t = await table(mode, format, false, [END_PHASE_RECOVER]);
      const before = await t.view();
      await t.answer(0, { choice: "to_ep" });
      expect((await t.view()).phase).toBe("end");
      await t.answer(0, { choice: "no" });
      const after = await t.view(1);
      expect(after).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      expect(after.seats[1]!.lp).toBe(before.seats[1]!.lp + 321);
      expect(after.log.slice(before.log.length).map((line) => line.text)).toContain("end");
      expect(states(after)).toEqual(Array(t.count).fill("in"));
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s removes the turn player immediately without its End Phase effects", async (format) => {
      const t = await table(mode, format, false, [END_PHASE_RECOVER]);
      const before = await t.view();
      const room = await t.post("surrender", 0);
      expect(room.role).toBe(format === "tag" ? "player" : "spectator");
      expect(states(room.engine!)).toEqual(Array.from({ length: t.count }, (_, seat) => seat === 0 || (format === "tag" && seat === 2) ? "out" : "in"));
      const commands = t.service.privateState(t.session.slug, "g").commands;
      expect(commands.map((entry) => entry.command.promptId)).toEqual(["eliminate:0"]);
      expect(room.engine!.log.slice(before.log.length).some((entry) => entry.text === "draw")).toBe(format !== "tag");
      // The core still runs the cut-short turn's End Phase event for living duelists
      // (ADR 0002). The leaver's card left the field, so its effect does not run.
      expect(room.engine!.seats[1]!.lp).toBe(before.seats[1]!.lp);
      expect(room.engine!.seats.every((seat) => !seat.pendingElimination)).toBe(true);
      if (format === "tag") expect(room.session).toMatchObject({ status: "completed", winnerSeat: 1 });
      else expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, result: null });
      const replayed = await replaySource(t.source(), DATA, commands.length);
      expect(format === "tag" ? replayed.seats[0] : replayed.spectator).toEqual(room.engine);
      for (const seat of replayed.spectator.seats) if (!seat.eliminated) {
        expect(seat.monsters.filter(Boolean)).toHaveLength(1);
        expect(seat.hand).toHaveLength(1);
      }
      await t.recover();
      expect((await t.post("view", 0)).engine).toEqual(room.engine);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-FFA-NO-ATTACK: %s own-turn surrender starts the next seat's Draw Phase and allows battle for the last living first-turn duelist", async (format) => {
      const t = await table(mode, format, false, [], 30_000, 1);
      const legacyWindow = legacyFirstBattleWindow(mode);
      const before = await t.view();
      const room = await t.post("surrender", 0);
      expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, phase: "main1", result: null });
      expect(room.engine!.seats[1]!.hand).toHaveLength(before.seats[1]!.hand.length + 1);
      expect(room.engine!.seats[1]!.deckCount).toBe(before.seats[1]!.deckCount - 1);
      const phases = room.engine!.log.slice(before.log.length).map((line) => line.text);
      expect(phases).toContain("Turn 2 — Player 2");
      expect(phases.indexOf("draw")).toBeLessThan(phases.indexOf("standby"));
      expect(phases.indexOf("standby")).toBeLessThan(phases.indexOf("main1"));
      for (let seat = 1; seat < t.count; seat++) {
        await reachMain(t, seat);
        const current = await t.view(seat);
        expect(current).toMatchObject({ turn: seat + 1, turnSeat: seat });
        expect(current.prompt!.options.some((option) => option.id === "to_bp"))
          .toBe(seat === t.count - 1 && !legacyWindow);
        await t.answer(seat, { choice: "to_ep" });
      }
      await reachMain(t, 1);
      const nextRound = await t.view(1);
      expect(nextRound).toMatchObject({ turn: t.count + 1, turnSeat: 1 });
      expect(nextRound.prompt!.options.some((option) => option.id === "to_bp")).toBe(true);
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(replayed.seats[1]).toEqual(nextRound);
    }, 60_000);

    it("FFA4 own-turn surrender skips an earlier eliminated seat", async () => {
      const t = await table(mode, "ffa4");
      await t.view();
      await t.post("surrender", 2);
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      expect(await t.view(1)).toMatchObject({ turn: 2, turnSeat: 1 });
      await t.post("surrender", 1);
      await reachMain(t, 3);
      const next = await t.view(3);
      expect(next).toMatchObject({ turn: 3, turnSeat: 3, result: null, eliminationOrder: [[2], [1]] });
      expect(states(next)).toEqual(["in", "out", "out", "in"]);
      // Seat 2 never had a turn and is out. Seat 3 is the last living first-turn
      // duelist, so R-FFA-NO-ATTACK allows its Battle Phase on turn 3.
      expect(next.prompt!.options.some((option) => option.id === "to_bp")).toBe(!legacyFirstBattleWindow(mode));
      await t.answer(3, { choice: "to_ep" });
      await reachMain(t, 0);
      expect((await t.view()).prompt!.options.some((option) => option.id === "to_bp")).toBe(true);
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("%s own-turn surrender auto-answers an open required prompt before leaving", async (format) => {
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetCountLimit(1)
e:SetOperation(function() Duel.SelectOption(0,30,31) end)
Duel.RegisterEffect(e,0)`]);
      const before = await t.view();
      expect(before.chain).toHaveLength(0);
      expect(before.prompt!.options.map((option) => option.id)).toEqual(["opt:0", "opt:1"]);
      const room = await t.post("surrender", 0);
      expect(states(room.engine!)).toEqual(Array.from({ length: t.count }, (_, seat) =>
        seat === 0 || (format === "tag" && seat === 2) ? "out" : "in"));
      if (format === "tag") expect(room.session).toMatchObject({ status: "completed", winnerSeat: 1 });
      else expect(room.engine).toMatchObject({ turn: 2, turnSeat: 1, phase: "main1", result: null });
      expect(t.source().commands.map((command) => command.promptId)).toEqual(["eliminate:0"]);
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(format === "tag" ? replayed.seats[0] : replayed.spectator).toEqual(room.engine);
    }, 60_000);

    it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s uses Surrender as the result reason", async (format) => {
      const t = await table(mode, format);
      await t.view();
      const order = format === "tag" || format === "1v1" ? [1] : Array.from({ length: t.count - 1 }, (_, index) => t.count - 1 - index);
      for (const seat of order) await t.post("surrender", seat);
      for (let seat = 0; seat < t.count; seat++) {
        const room = await t.post("view", seat);
        expect(room.session).toMatchObject({ status: "completed", winnerSeat: 0, resultReason: "Surrender" });
        expect(room.engine!.result).toMatchObject({ winnerSeat: 0, reason: "Surrender" });
      }
      const replay = await t.post("replay", 0) as unknown as DuelReplay;
      expect(replay.frames.at(-1)!.view.result?.reason).toBe("Surrender");
      if (format === "tag") expect(replay.frames.at(-1)!.view.log.filter((line) => line.text.includes("wins"))
        .map((line) => line.text)).toEqual(["Team 1 wins (Surrender)"]);
    }, 60_000);

    it("saved Surrendered results remain readable", async () => {
      const t = await table(mode, "1v1");
      await t.view();
      await t.post("surrender", 1);
      const row = t.db.prepare("SELECT snapshot_public_json, snapshot_seat0_json, snapshot_seat1_json, snapshot_seats_json FROM duels WHERE id = ?")
        .get(t.session.id) as Record<string, string | null>;
      for (const [column, saved] of Object.entries(row)) {
        if (saved) t.db.prepare(`UPDATE duels SET ${column} = ? WHERE id = ?`)
          .run(saved.replaceAll('"Surrender"', '"Surrendered"'), t.session.id);
      }
      t.db.prepare("UPDATE duels SET result_reason = 'Surrendered' WHERE id = ?").run(t.session.id);
      await t.recover();
      const room = await t.post("view");
      expect(room.session).toMatchObject({ status: "completed", winnerSeat: 0, resultReason: "Surrendered" });
      expect(room.engine!.result).toMatchObject({ winnerSeat: 0, reason: "Surrendered" });
      const replay = await t.post("replay") as unknown as DuelReplay;
      expect(replay.frames.at(-1)!.view.result).toMatchObject({ winnerSeat: 0, reason: "Surrender" });
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

    it.each([0, 1])("1v1 seat %s surrender still ends an open chain at once", async (leaver) => {
      const t = await table(mode, "1v1", true);
      await reachMain(t);
      const activate = (await t.view()).prompt!.options.find((option) => option.card?.code === 55144522 && option.id.startsWith("activate:"));
      await t.answer(0, { choice: activate!.id });
      for (let step = 0; step < 10 && !(await t.view()).chain?.length; step++) await passPrompt(t);
      const before = await t.view();
      expect(before.chain).toHaveLength(1);
      const commands = t.source().commands;
      const room = await t.post("surrender", leaver);
      expect(room.session).toMatchObject({ status: "completed", winnerSeat: 1 - leaver, resultReason: "Surrender" });
      expect(room.engine).toMatchObject({ turn: before.turn, phase: before.phase, prompt: null, chain: before.chain });
      expect(t.source().commands).toEqual(commands);
    }, 60_000);

    it("Tag completed room reads use the saved board without replay", async () => {
      const t = await table(mode, "tag");
      await t.view();
      await t.post("surrender", 3);
      t.failReplays();
      const workers = t.workers.length;
      for (let seat = 0; seat < t.count; seat++) {
        const room = await t.post("view", seat);
        expect(room).toMatchObject({ role: "player", mySeat: seat,
          session: { status: "completed", winnerSeat: 0 }, engine: { result: { winnerSeat: 0, reason: "Surrender" } } });
        expect(t.workers).toHaveLength(workers);
      }
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: refuses retired turn-end journal commands without changing the board", async () => {
      const t = await table(mode, "ffa4");
      const before = await t.view();
      await expect(t.workers.at(-1)!.eliminate(3, 0, true)).rejects.toThrow("retired turn-end surrender rule");
      expect(await t.view()).toEqual(before);
      expect(t.source().commands).toEqual([]);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: separate immediate losses keep separate places even with empty fields", async () => {
      const t = await table(mode, "ffa4", false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
e:SetCountLimit(1)
e:SetOperation(function()
  for p=1,3 do Duel.RemoveCards(Duel.GetMatchingGroup(aux.TRUE,p,LOCATION_ALL,0,nil)) end
  Duel.SelectOption(0,30,31)
end)
Duel.RegisterEffect(e,0)`]);
      await t.view();
      await t.post("surrender", 3);
      await t.post("surrender", 2);
      expect((await t.view()).eliminationOrder).toEqual([[3], [2]]);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s keeps only earlier losers as spectators on the result screen", async (format) => {
      const t = await table(mode, format);
      await t.view();
      const earlier = format === "ffa3" ? [2] : [3, 2];
      for (const seat of earlier) await t.post("surrender", seat);
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      for (const seat of earlier) expect((await t.post("view", seat)).role).toBe("spectator");
      await t.post("surrender", 1);
      for (let step = 0; step < 10 && t.service.get(t.session.slug, "g").status === "active"; step++) await passPrompt(t);
      for (let seat = 0; seat < t.count; seat++) {
        const room = await t.post("view", seat);
        expect(room.session).toMatchObject({ status: "completed", winnerSeat: 0 });
        expect(room.role).toBe(earlier.includes(seat) ? "spectator" : "player");
        expect(room.mySeat).toBe(earlier.includes(seat) ? null : seat);
        expect(room.myDeck === null).toBe(earlier.includes(seat));
        expect(states(room.engine!)).toEqual(Array.from({ length: t.count }, (_, index) => index === 0 ? "in" : "out"));
        if (seat === 0) expect(room.engine!.seats[0]!.hand[0]!.code).not.toBeNull();
      }
      const replay = await t.post("replay", 1) as unknown as DuelReplay;
      expect(replay).toMatchObject({ role: "player", mySeat: 1 });
      await t.recover();
      expect((await t.post("view", 1)).role).toBe("player");
      expect((await t.post("view", earlier[0])).role).toBe("spectator");
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("R-COMMON-SURRENDER-EOT: %s keeps draw seats as players", async (format) => {
      const count = seatCountFor(format);
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_END)
e:SetOperation(function()
  Duel.SelectYesNo(0,30)
  for p=0,${count - 1} do Duel.SetLP(p,0) end
end)
Duel.RegisterEffect(e,0)`]);
      await t.view();
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      await t.answer(0, { choice: "no" });
      for (let seat = 0; seat < count; seat++) {
        const room = await t.post("view", seat);
        expect(room.session).toMatchObject({ status: "completed", winnerSeat: null });
        expect(room.role).toBe("player");
        expect(room.mySeat).toBe(seat);
        expect(room.myDeck).not.toBeNull();
        // R-FFA-ELIMINATION: final draw seats are out; result roles stay player. Tag sends no seat-loss message.
        expect(states(room.engine!)).toEqual(Array(count).fill(format === "tag" ? "in" : "out"));
        if (format === "tag") expect(room.engine!.seats[seat]!.hand[0]!.code).not.toBeNull();
        else expect(room.engine!.seats[seat]!.hand).toHaveLength(0);
      }
      const replay = await t.post("replay", 0) as unknown as DuelReplay;
      expect(replay).toMatchObject({ role: "player", mySeat: 0 });
      expect(replay.frames.at(-1)!.view.seats.every((seat) => seat.eliminated === (format !== "tag"))).toBe(true);
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("R-COMMON-SURRENDER-EOT: %s keeps an earlier loser as a spectator after a draw", async (format) => {
      const earlier = seatCountFor(format) - 1;
      const t = await table(mode, format, false, [`local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_END)
e:SetCondition(function() return Duel.GetTurnCount()==2 end)
e:SetOperation(function()
  Duel.SelectYesNo(0,30)
  for p=0,${earlier - 1} do Duel.SetLP(p,0) end
end)
Duel.RegisterEffect(e,0)`]);
      await t.view();
      await t.post("surrender", earlier);
      await t.answer(0, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      expect((await t.post("view", earlier)).role).toBe("spectator");
      await t.answer(1, { choice: "to_ep" });
      await t.answer(0, { choice: "no" });
      await t.answer(0, { choice: "no" });
      const final = await t.view();
      expect(final.result?.winnerSeat).toBeNull();
      expect(final.eliminationOrder).toHaveLength(2);
      expect(final.eliminationOrder![0]).toEqual([earlier]);
      expect([...final.eliminationOrder![1]!].sort()).toEqual(Array.from({ length: earlier }, (_, seat) => seat));
      expect(states(final)).toEqual(Array(t.count).fill("out"));
      for (let seat = 0; seat < t.count; seat++) {
        const room = await t.post("view", seat);
        expect(room.session).toMatchObject({ status: "completed", winnerSeat: null });
        expect(room.role).toBe(seat === earlier ? "spectator" : "player");
        expect(room.mySeat).toBe(seat === earlier ? null : seat);
        expect(room.myDeck === null).toBe(seat === earlier);
      }
      const replayed = await replaySource(t.source(), DATA, t.source().commands.length);
      expect(states(replayed.spectator)).toEqual(states(final));
      expect(replayed.spectator.eliminationOrder).toEqual(final.eliminationOrder);
      await t.recover();
      expect((await t.post("view", earlier)).role).toBe("spectator");
      expect((await t.post("view", 1)).role).toBe("player");
    }, 60_000);

    it.each(["ffa3", "ffa4", "tag"] as const)("%s room reads do not replay a journal with no loss", async (format) => {
      const t = await table(mode, format);
      await t.view();
      t.service.interrupt(t.session.slug, "g", "Test interruption");
      t.failReplays();
      const workers = t.workers.length;
      for (let read = 0; read < 2; read++) for (let seat = 0; seat < t.count; seat++) {
        const room = await t.post("view", seat);
        expect(room).toMatchObject({ role: "player", mySeat: seat, engine: null });
        expect(t.workers).toHaveLength(workers);
      }
    }, 60_000);

    it.each(["ffa3", "ffa4"] as const)("%s room reads replay a failed loss check only for that seat", async (format) => {
      const t = await table(mode, format);
      const leaver = t.count - 1;
      await t.view();
      await t.post("surrender", leaver);
      t.service.interrupt(t.session.slug, "g", "Test interruption");
      t.failReplays();
      let workers = t.workers.length;
      for (let read = 0; read < 2; read++) for (let seat = 0; seat < t.count; seat++) {
        const room = await t.post("view", seat);
        expect(room).toMatchObject({ role: "player", mySeat: seat, engine: null });
        if (seat === leaver) workers++;
        expect(t.workers).toHaveLength(workers);
      }
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: an interrupted room stays available when replay cannot check the loss", async () => {
      const t = await table(mode, "ffa4");
      await t.view();
      await t.post("surrender", 3);
      t.service.interrupt(t.session.slug, "g", "Test interruption");
      t.db.prepare("UPDATE duels SET bundle_version = ? WHERE id = ?").run("old-test-engine", t.session.id);
      await t.recover();
      for (let seat = 0; seat < t.count; seat++) {
        const room = await t.post("view", seat);
        expect(room).toMatchObject({ role: "player", mySeat: seat, engine: null });
        expect(room.session.status).toBe("interrupted");
      }
      await t.post("replay", 3, {}, 409);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: a save error keeps the journal and setup unchanged", async () => {
      const t = await table(mode, "ffa4");
      const before = await t.view();
      t.db.exec(`CREATE TRIGGER reject_surrender_setup BEFORE INSERT ON duel_commands
        BEGIN SELECT RAISE(ABORT,'Reject surrender command'); END`);
      await t.post("surrender", 3, {}, 400);
      expect(t.source().commands).toEqual([]);
      expect(t.service.privateState(t.session.slug, "g").setup?.surrenderedSeats).toBeUndefined();
      t.db.exec("DROP TRIGGER reject_surrender_setup");
      expect(await t.view()).toEqual(before);
    }, 60_000);

    it("R-COMMON-SURRENDER-EOT: a stale view hides the private cards after elimination", async () => {
      const t = await table(mode, "ffa4", false, [], 2500);
      await t.view();
      const ended = await t.post("surrender", 3);
      expect(states(ended.engine!)).toEqual(["in", "in", "in", "out"]);
      const worker = t.workers.at(-1)!;
      worker.holdViews = true;
      try {
        const stale = await t.post("view", 3) as DuelRoom & { stale: boolean };
        expect(stale.stale).toBe(true);
        expect(stale.role).toBe("spectator");
        expect(stale.mySeat).toBeNull();
        expect(stale.myDeck).toBeNull();
        expect(stale.engine!.prompt).toBeNull();
        expect(stale.engine!.seats.flatMap((seat) => seat.hand).every((card) => card.code == null)).toBe(true);
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

    it("R-COMMON-SURRENDER-EOT: the report journal replays the immediate loss at its saved step", async () => {
      const dir = mkdtempSync(join(tmpdir(), "surrender-eot-report-"));
      const oldScenarios = process.env.DUEL_SCENARIOS;
      const oldReports = process.env.DUEL_REPORT_DIR;
      process.env.DUEL_SCENARIOS = "1";
      process.env.DUEL_REPORT_DIR = dir;
      try {
        const t = await table(mode, "ffa4");
        await t.view();
        await t.post("surrender", 3);
        const lostViews = await Promise.all(Array.from({ length: t.count }, (_, seat) => t.view(seat)));
        const report = await t.post("report", 0, { note: "Test the saved surrender step" }) as unknown as { path: string };
        const file = join(report.path, "journal.jsonl");
        const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        expect(lines[0].setup.surrenderedSeats).toBeUndefined();
        expect(lines.slice(1)).toEqual([expect.objectContaining({ type: "eliminate", seq: 1, seat: 3,
          command: expect.objectContaining({ promptId: "eliminate:0" }) })]);
        const source = loadSource(file);
        expect((await replaySource(source, DATA, source.commands.length)).seats).toEqual(lostViews);
        const flatFile = join(dir, "journal.json");
        writeFileSync(flatFile, JSON.stringify(parseJournalText(readFileSync(file, "utf8"))));
        expect((await replaySeats(loadNSource(flatFile), DATA, source.commands.length)).seats).toEqual(lostViews);
        const runCli = (journal: string, stopAt?: number) => JSON.parse(execFileSync("npx", ["tsx", "scripts/replay-journal.ts",
          journal, "--data", DATA, "--json", "--views", ...(stopAt === undefined ? [] : ["--stop-at", String(stopAt)])],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
        const mid = runCli(file);
        expect(mid).toMatchObject({ ok: true, replayed: 1, total: 1 });
        for (let seat = 0; seat < t.count; seat++) expect(mid.views[String(seat)]).toEqual(lostViews[seat]);
        await t.answer(0, { choice: "to_ep" });
        await t.answer(0, { choice: "no" });
        const final = await Promise.all(Array.from({ length: t.count }, (_, seat) => t.workers.at(-1)!.view(seat)));
        const endedReport = await t.post("report", 0, { note: "Test the next living turn" }) as unknown as { path: string };
        const endedFile = join(endedReport.path, "journal.jsonl");
        const end = runCli(endedFile);
        expect(end).toMatchObject({ ok: true, replayed: 3, total: 3 });
        for (let seat = 0; seat < t.count; seat++) expect(end.views[String(seat)]).toEqual(final[seat]);
        const stopped = runCli(endedFile, 1);
        expect(stopped).toMatchObject({ ok: true, replayed: 1, total: 3 });
        for (let seat = 0; seat < t.count; seat++) expect(stopped.views[String(seat)]).toEqual(lostViews[seat]);
      } finally {
        if (oldScenarios === undefined) delete process.env.DUEL_SCENARIOS;
        else process.env.DUEL_SCENARIOS = oldScenarios;
        if (oldReports === undefined) delete process.env.DUEL_REPORT_DIR;
        else process.env.DUEL_REPORT_DIR = oldReports;
        rmSync(dir, { recursive: true, force: true });
      }
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

async function reachMain(t: Awaited<ReturnType<typeof table>>, seat = 0) {
  await t.view();
  for (let step = 0; step < 30; step++) {
    if ((await t.view(seat)).prompt?.options.some((option) => option.id === "to_ep")) return;
    await passPrompt(t);
  }
  throw new Error("The Main Phase prompt did not open");
}
