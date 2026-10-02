import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, teamOfSeat, type DuelEngineView, type DuelRoom } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost } from "../src/host.js";
import { buildPracticeBotDeck, chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { getPreset } from "../src/presets/index.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "test-stack-multiplayer";
const STACKS = ["e2e", "staging"] as const;
type Stack = typeof STACKS[number];

// Read only the explicit launch settings. Do not inherit Vitest's default flag or read an env file.
function tableFlag(stack: Stack, service: "duel" | "web"): string | undefined {
  if (stack === "e2e") {
    const source = readFileSync(new URL("../../e2e/stack/start.mjs", import.meta.url), "utf8");
    const launch = source.split(`run("${service}",`)[1]?.split(/\nrun\(/)[0];
    return launch?.match(/^\s+MULTIPLAYER_TABLES:\s*"([^"]+)"/m)?.[1];
  }
  const source = readFileSync(new URL("../../../docker-compose.staging.yml", import.meta.url), "utf8");
  const launch = source.split(new RegExp(`^  ${service}:\\s*$`, "m"))[1]?.split(/^  \w+:\s*$/m)[0];
  return launch?.match(/^\s+- MULTIPLAYER_TABLES=(.*)$/m)?.[1].trim();
}

function useStack(stack: Stack) {
  vi.stubEnv("MULTIPLAYER_TABLES", tableFlag(stack, "duel") ?? "");
  vi.stubEnv("DUEL_SCENARIOS", "1");
}
afterEach(() => vi.unstubAllEnvs());

function hostTable(count: number) {
  const db = new Database(":memory:");
  migrate(db);
  const players = Array.from({ length: count }, (_, seat) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)",
  ).run("g", `u${seat}`, `P${seat}`).lastInsertRowid));
  const service = createDuelService(db);
  const workers: GameWorker[] = [];
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000,
    createWorker: () => { const worker = new GameWorker(); workers.push(worker); return worker; } });
  const post = async (op: string, extra: Record<string, unknown> = {}, seat = 0) => {
    const raw = JSON.stringify({ op, guildId: "g", playerId: players[seat], ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
    return { status: response.status, data: await response.json() as DuelRoom & { slug: string; error?: string } };
  };
  return { db, players, service, workers, post, close: async () => { await host.close(); db.close(); } };
}

function checkCore(worker: GameWorker, mode: "normal" | "domain") {
  const file = mode === "domain" ? "ocgcore.multi-domain.wasm" : "ocgcore.multi.wasm";
  expect(worker.debugState().wasmFile).toBe(file);
  expect(worker.debugState().wasmSha).toBe(createHash("sha256").update(readFileSync(join(DATA, file))).digest("hex"));
}

for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`${mode} tables use the test stack configuration`, [needs.cards(DATA),
    mode === "domain" ? needs.domainMulti(DATA, join(DATA, "ocgcore.multi-domain.wasm")) : needs.installedMulti(DATA)], () => {
    const cases = STACKS.flatMap((stack) => (["ffa3", "ffa4", "tag"] as const).map((format) => ({ stack, format })));
    it.each(cases)("$stack opens $format, accepts a real turn, and stores the result for every seat", async ({ stack, format }) => {
      useStack(stack);
      const count = seatCountFor(format);
      const t = hostTable(count);
      try {
        const session = t.service.create({ guildId: "g", organizerPlayerId: t.players[0]!, name: "Test stack", mode, format,
          settings: { banlist: "none", turnSeconds: 0, shuffleDeck: false } });
        for (const player of t.players.slice(1)) t.service.join(session.slug, "g", player);
        const deck = buildPracticeBotDeck(mode, DATA);
        for (let seat = 0; seat < count; seat++) {
          const submitted = await t.post("deck", { slug: session.slug, deck }, seat);
          expect(submitted.status, submitted.data.error).toBe(200);
        }
        const started = await t.post("start", { slug: session.slug });
        expect(started.status, started.data.error).toBe(200);
        expect(tableFlag(stack, "web")).toBe("1");
        const worker = t.workers[0]!;
        checkCore(worker, mode);
        const initial = await worker.view(0);
        expect(initial.prompt?.seat).toBe(0);
        expect(initial.prompt?.options.some((option) => option.id === "to_ep")).toBe(true);
        const endedTurn = await t.post("respond", { slug: session.slug, command: {
          promptId: initial.prompt!.id, revision: initial.revision, answer: { choice: "to_ep" },
        } });
        expect(endedTurn.status, endedTurn.data.error).toBe(200);
        for (let viewer = 0; viewer < count; viewer++) {
          const view = await worker.view(viewer);
          expect(view.format).toBe(format);
          expect(view.turnSeat).toBe(1);
          expect(view.turn).toBe(2);
          expect(view.prompt?.seat ?? viewer).toBe(viewer);
          expect(view.seats).toHaveLength(count);
          for (const seat of view.seats) {
            expect(seat.lp).toBe(format === "tag" ? 16000 : 8000);
            expect(seat.eliminated).toBe(false);
            expect(seat.monsters.filter(Boolean)).toEqual([]);
            expect(seat.spells.filter(Boolean)).toEqual([]);
            expect(seat.graveyard).toEqual([]);
            expect(seat.banished).toEqual([]);
            expect(seat.hand.length).toBeGreaterThan(0);
            const visible = seat.seat === viewer || (format === "tag" && teamOfSeat(format, seat.seat) === teamOfSeat(format, viewer));
            expect(seat.hand.every((card) => (card.code != null) === visible)).toBe(true);
            if (mode === "domain") expect(seat.deckMaster).toMatchObject({ card: { code: deck.deckMaster }, inZone: true, returns: 0 });
          }
        }
        for (let seat = count - 1; seat >= 1 && t.service.get(session.slug, "g").status === "active"; seat--) {
          expect((await t.post("surrender", { slug: session.slug }, seat)).status).toBe(200);
        }
        const result = format === "tag" ? { winnerSeat: 0, winnerTeam: 0, reason: "Surrender" } : { winnerSeat: 0, reason: "Surrender" };
        for (let seat = 0; seat < count; seat++) {
          const final = await t.post("view", { slug: session.slug }, seat);
          expect(final.status).toBe(200);
          expect(final.data.session.status).toBe("completed");
          expect(final.data.engine?.result).toEqual(result);
          expect(final.data.engine?.prompt).toBeNull();
          expect(final.data.engine?.seats).toHaveLength(count);
          for (const member of final.data.engine!.seats) {
            expect(member.monsters.filter(Boolean)).toEqual([]);
            expect(member.spells.filter(Boolean)).toEqual([]);
            expect(member.lp).toBe(format === "tag" ? 16000 : 8000);
            if (mode === "domain") expect(member.deckMaster?.card.code).toBe(deck.deckMaster);
          }
        }
        const saved = t.db.prepare("select snapshot_seats_json from duels where web_slug = ?").get(session.slug) as { snapshot_seats_json: string };
        const views = JSON.parse(saved.snapshot_seats_json) as DuelEngineView[];
        expect(views).toHaveLength(count);
        for (const view of views) { expect(view.result).toEqual(result); expect(view.prompt).toBeNull(); }
      } finally { await t.close(); }
    }, 30_000);
  });
}

describeWithCores("test stack presets use the real multiplayer core", [needs.cards(DATA), needs.installedMulti(DATA)], () => {
  const cases = STACKS.flatMap((stack) => ["mind-crush-ffa4-pick", "tag-jinzo-blocks-traps"].map((presetId) => ({ stack, presetId })));
  it.each(cases)("$stack starts $presetId and advances the real preset", async ({ stack, presetId }) => {
    useStack(stack);
    const t = hostTable(1);
    try {
      const started = await t.post("start-preset", { presetId, seed: ["1", "2", "3", "4"] });
      expect(started.status, started.data.error).toBe(200);
      expect(tableFlag(stack, "web")).toBe("1");
      const worker = t.workers[0]!;
      checkCore(worker, "normal");
      const before = await worker.view(0);
      expect(before.prompt?.seat).toBe(0);
      const moved = await t.post("respond", { slug: started.data.slug, command: {
        promptId: before.prompt!.id, revision: before.revision, answer: chooseSurrenderedAnswer(before.prompt!),
      } });
      expect(moved.status, moved.data.error).toBe(200);
      const preset = getPreset(presetId)!;
      for (let seat = 0; seat < seatCountFor(preset.format); seat++) {
        const view = await worker.view(seat);
        expect(view.format).toBe(preset.format);
        expect(view.revision).toBeGreaterThan(before.revision);
        expect(view.seats).toHaveLength(seatCountFor(preset.format));
        for (const member of view.seats) {
          expect(member.lp).toBe(preset.format === "tag" ? 16000 : 8000);
          expect(member.eliminated).toBe(false);
          expect(member.graveyard).toEqual([]);
          expect(member.banished).toEqual([]);
          expect(member.spells.filter(Boolean)).toHaveLength(presetId === "mind-crush-ffa4-pick" ? Number(member.seat === 0) : 1);
          expect(member.monsters.filter(Boolean).map((card) => card!.code)).toEqual(presetId === "tag-jinzo-blocks-traps" && member.seat === 0 ? [77585513] : []);
        }
      }
    } finally { await t.close(); }
  }, 30_000);
});
