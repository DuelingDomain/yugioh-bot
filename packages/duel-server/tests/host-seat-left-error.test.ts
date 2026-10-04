import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcgMessageType } from "ocgcore-wasm";
import { migrate } from "@yugidraft/shared/db";
import { opponentSeatsOf, seatCountFor, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import type { CardDatabase } from "../src/cards.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { pinnedEngineVersion } from "../src/multi-scripts.js";
import { mapPrompt, resolveAnswer } from "../src/prompts.js";
import type { DuelGameWorker } from "../src/worker-client.js";

vi.mock("../src/multi-scripts.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/multi-scripts.js")>(),
  activeMultiScriptsHash: () => null,
}));

const SECRET = "seat-left-error-test";
const cards = { get: () => undefined, resolveLabel: () => "", system: () => undefined } as unknown as CardDatabase;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function fixture(format: DuelFormat, state: "eliminated" | "pendingElimination") {
  const dataDirectory = mkdtempSync(join(tmpdir(), "host-seat-left-"));
  writeFileSync(join(dataDirectory, "manifest.json"), JSON.stringify({ bundleVersion: "fixture" }));
  const db = new Database(":memory:");
  let host: DuelHost | undefined;
  cleanups.push(async () => { await host?.close(); db.close(); rmSync(dataDirectory, { recursive: true, force: true }); });
  migrate(db);
  const count = seatCountFor(format);
  const players = Array.from({ length: count }, (_, seat) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)",
  ).run(`u${seat}`, `P${seat}`).lastInsertRowid));
  const service = createDuelService(db);
  const session = service.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Pick test", mode: "normal", format,
    settings: { validateDeck: false, turnSeconds: 0 } });
  for (const player of players.slice(1)) service.takeSeat(session.slug, "g1", player);
  for (const player of players) service.setDeck(session.slug, "g1", player, { main: Array(40).fill(1), extra: [], side: [] });
  service.activate(session.slug, "g1", players[0]!, ["1", "2", "3", "4"], pinnedEngineVersion("fixture", count, null),
    null, { firstTurnDraw: false });
  const opponents = opponentSeatsOf(format, 0);
  const left = opponents[0]!;
  const pending = mapPrompt({ type: OcgMessageType.SELECT_OPTION, player: 0,
    options: opponents.map((seat) => BigInt(0xfffe0000 + seat)) } as never, cards, "p1");
  const view = { revision: 0, mode: "normal", format, viewerSeat: 0, turn: 1, turnSeat: 0, phase: "main1",
    prompt: pending.prompt, result: null, events: [], log: [],
    seats: Array.from({ length: count }, (_, seat) => ({ seat, lp: 8000, [state]: seat === left,
      deckCount: 40, extraCount: 0, handCount: 0, hand: [], monsters: [], spells: [], graveyard: [], banished: [], extra: [] })),
  } as unknown as DuelEngineView;
  const worker: DuelGameWorker = {
    running: true, create: async () => {}, view: async () => view, search: async () => [], close: vi.fn(),
    answer: async (seat, id, answer) => { resolveAnswer(pending, seat, id, answer, cards, new Set([left])); },
  };
  host = createDuelHost({ db, dataDirectory, secret: SECRET, searchCards: () => [],
    pollIntervalMs: 60_000, stallMs: 0, createWorker: () => worker });
  async function post(choice: string) {
    const raw = JSON.stringify({ op: "respond", slug: session.slug, guildId: "g1", playerId: players[0],
      command: { revision: 0, promptId: "p1", answer: { choice } } });
    return host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
  }
  return { post, service, slug: session.slug, worker };
}

describe("host opponent picks for a seat that has left", () => {
  it.each((["ffa3", "ffa4", "tag"] as const).flatMap((format) =>
    (["eliminated", "pendingElimination"] as const).map((state) => ({ format, state }))))(
    "returns the seat-left code for $format with $state", async ({ format, state }) => {
      const t = fixture(format, state);
      const response = await t.post("opt:0");
      expect(response.status, await response.clone().text()).toBe(400);
      expect(await response.json()).toEqual({ code: "seat_left", error: "That player has left. Pick again." });
      expect(t.service.privateState(t.slug, "g1").commands).toEqual([]);
      expect(t.worker.close).not.toHaveBeenCalled();
    },
  );

  it("keeps the old response for a normal invalid answer", async () => {
    const response = await fixture("ffa3", "eliminated").post("opt:99");
    expect(response.status, await response.clone().text()).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid answer" });
  });
});
