import { createHmac } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { emptyCardQuery, normalizeDuelSettings, type DuelAnswer, type DuelCardInfo, type DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { pinnedEngineVersion } from "../src/multi-scripts.js";
import { createScriptErrorRecorder, topScriptErrors } from "../src/script-error-store.js";
import { cardScriptHash } from "../src/card-script-hash.js";
import { loadCardDatabase } from "../src/cards.js";
import { createAutoBlockPolicy, clearAutoBlock } from "../src/script-error-autoblock.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { CARD_SCRIPT_ERROR_TEXT, type DuelScriptError } from "../src/script-errors.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";

// Keep the host's real worker callbacks and recorder; replace only the core transport.
// One deterministic accepted answer reproduces an error on recovery and replay.
vi.mock("../src/worker-client.js", () => ({
  GameWorker: class implements DuelGameWorker {
    running = true;
    private step = 0;
    private options!: GameOptions;
    constructor(private onScriptError?: (error: DuelScriptError) => void) {}
    async create(options: GameOptions) { this.options = options; }
    async view(viewer: number | null): Promise<DuelEngineView> {
      return {
        revision: this.step + 1, turn: 1, turnSeat: 0, phase: "main1",
        seats: [0, 1].map(seat => ({ seat, lp: 8000, hand: [], deckCount: 40, extraCount: 0,
          extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
        prompt: viewer === 0 ? { id: `fixture-${this.step}`, seat: 0, kind: "choice", title: "Main",
          options: [{ id: "continue", label: "Continue" }] } : null,
        chain: [], result: null,
        events: this.step ? [{ id: 1, kind: "script-error", text: CARD_SCRIPT_ERROR_TEXT }] : [],
        log: this.step ? [{ id: 1, text: CARD_SCRIPT_ERROR_TEXT }] : [],
      };
    }
    async answer(seat: number, promptId: string, answer: DuelAnswer) {
      expect(seat).toBe(0);
      expect(promptId).toBe(`fixture-${this.step}`);
      expect(answer).toEqual({ choice: "continue" });
      this.step++;
      this.onScriptError?.({ code: 3743515, scriptFile: "c3743515.lua", line: 1,
        message: "fixture runtime failure", index: this.step, commandHash: `fixture-answer-${this.step}`,
        mode: this.options.mode, format: this.options.format ?? "1v1", engine: this.options.engine ?? "pinned",
        scriptErrorMode: this.options.scriptErrorMode ?? "tolerant" });
    }
    async search(_query: string): Promise<DuelCardInfo[]> { return []; }
    async close() { this.running = false; }
  },
}));

let DATA: string;
beforeAll(() => {
  DATA = createHostDataFixture([
    { code: 3743515, name: "Inaba White Rabbit", type: 33 },
    { code: 3743516, name: "Inaba White Rabbit", type: 33, alias: 3743515 },
    { code: 3743615, name: "Far alias", type: 33, alias: 3743515 },
    { code: 15025844, name: "Mystical Elf" },
  ]);
});
afterAll(() => { rmSync(DATA, { recursive: true, force: true }); });

const secret = "auto-block-test";
async function request(host: DuelHost, body: Record<string, unknown>, status = 200): Promise<any> {
  const raw = JSON.stringify(body);
  const response = await host.handle(new Request("http://local/internal/duel", { method: "POST", body: raw,
    headers: { "content-type": "application/json", "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
  const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(status); return result;
}
describe("automatic blocks through host and replay", () => {
  it.each(["legacy", "pinned"] as const)("%s: blocks new duels and deck checks while live/recovered/replayed state stays identical", async engine => {
    vi.stubEnv("DUEL_DATA_DIR", DATA);
    vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_DUELS", "2");
    vi.stubEnv("DUEL_1V1_ENGINE", engine);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new Database(":memory:"); migrate(db);
    const players = [0, 1].map(i => seedIdentity(db, { guildId: "g", name: `P${i}`, userId: seedUser(db, `auto${i}`).userId }).playerId);
    const duels = createDuelService(db);
    const options: GameOptions = {
      mode: "normal", dataDirectory: DATA, seed: ["1", "2", "3", "4"],
      settings: normalizeDuelSettings("normal", { validateDeck: false, banlist: "none", startingHand: 1 }),
      decks: [0, 1].map(() => ({ main: [3743515, ...Array(39).fill(15025844)], extra: [], side: [] })),
      startupScripts: [{ name: "fixture-startup.lua", content: "-- saved fixture startup" }],
    };
    const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Existing", mode: "normal", settings: options.settings });
    duels.takeSeat(session.slug, "g", players[1]!);
    players.forEach((player, seat) => duels.setDeck(session.slug, "g", player, options.decks[seat]!));
    const version = JSON.parse(readFileSync(`${DATA}/manifest.json`, "utf8")).bundleVersion;
    duels.activate(session.slug, "g", players[0]!, options.seed, pinnedEngineVersion(version, 2, null), null,
      { engine, scriptErrorMode: "tolerant", firstTurnDraw: false, startupScripts: options.startupScripts!.map(script => script.content) });
    const prior = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Earlier", mode: "normal", settings: options.settings });
    duels.takeSeat(prior.slug, "g", players[1]!);
    const policy = createAutoBlockPolicy(db, { bundleVersion: version, scriptHash: (code, kind) => cardScriptHash(loadCardDatabase(DATA), code, kind) });
    createScriptErrorRecorder(db, () => {}, policy)(prior.id, { code: 3743515, scriptFile: "c3743515.lua", line: 1, message: "earlier failure", index: 1, mode: "normal", format: "1v1", engine, scriptErrorMode: "tolerant" });
    const makeHost = () => createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60000 });
    let host = makeHost();
    const base = { slug: session.slug, guildId: "g" };
    const views = (): Promise<DuelEngineView[]> => Promise.all(players.map(async playerId => (await request(host, { ...base, op: "view", playerId })).engine));
    try {
      for (let step = 0; step < 80; step++) {
        const current = await views(); if (current[0]!.events.some(event => event.kind === "script-error")) break;
        const seat = current.findIndex(view => view.prompt !== null), view = current[seat]!;
        await request(host, { ...base, op: "respond", playerId: players[seat], command: { promptId: view.prompt!.id, revision: view.revision, answer: { choice: "continue" } } });
      }
      const live = await views(), journal = duels.privateState(session.slug, "g").commands;
      const count = topScriptErrors(db)[0]!.count;
      expect(count).toBeGreaterThan(0);
      expect(journal).toHaveLength(1);
      expect(db.prepare("SELECT code FROM card_script_auto_blocks WHERE cleared_at IS NULL").all()).toEqual([{ code: 3743515 }]);
      const blockedDeck = { ...options.decks[0]!, main: [3743515, ...options.decks[0]!.main] };
      const check = await request(host, { op: "check-deck", guildId: "g", playerId: players[0], mode: "normal", deck: blockedDeck, settings: options.settings });
      expect(check.report.issues[0].message).toContain("is unavailable: Its effect script is being investigated");
      const query = await request(host, { op: "card-query", guildId: "g", playerId: players[0], cardQuery: { ...emptyCardQuery(), text: "3743515" } });
      expect(query.cards[0].unavailableReason).toBe("Its effect script is being investigated");
      for (const code of [3743516, 3743615, 15025844]) {
        const aliasDeck = { ...options.decks[0]!, main: [code, ...Array(39).fill(15025844)] };
        const aliasCheck = await request(host, { op: "check-deck", guildId: "g", playerId: players[0], mode: "normal", deck: aliasDeck, settings: options.settings });
        expect(aliasCheck.report.issues.some((issue: { message: string }) => issue.message.includes("is unavailable"))).toBe(code === 3743516);
        const aliasQuery = await request(host, { op: "card-query", guildId: "g", playerId: players[0], cardQuery: { ...emptyCardQuery(), text: String(code) } });
        expect(aliasQuery.cards[0].unavailableReason).toBe(code === 3743516 ? "Its effect script is being investigated" : undefined);
      }
      const next = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "New", mode: "normal", settings: options.settings });
      duels.takeSeat(next.slug, "g", players[1]!);
      players.forEach(player => duels.setDeck(next.slug, "g", player, blockedDeck));
      const refused = await request(host, { op: "start", slug: next.slug, guildId: "g", playerId: players[0] }, 400);
      expect(refused.error).toContain("is unavailable: Its effect script is being investigated");
      expect(await views()).toEqual(live);
      expect(duels.privateState(session.slug, "g").commands).toEqual(journal);
      await host.close(); host = makeHost();
      expect(await views()).toEqual(live);
      expect(duels.privateState(session.slug, "g").commands).toEqual(journal);
      expect(topScriptErrors(db)[0]!.count).toBe(count);
      duels.complete(session.slug, "g", 0, "Replay test");
      const replay = await request(host, { ...base, op: "replay", playerId: players[0] });
      expect(JSON.stringify(replay)).toContain("Card script error:");
      expect(JSON.stringify(replay)).not.toContain("Its effect script is being investigated");
      expect(topScriptErrors(db)[0]!.count).toBe(count);
      // Reconstruct a fresh replay after clearing the admission block, bypassing the host replay cache.
      expect(clearAutoBlock(db, 3743515)).toBe(true);
      await host.close(); host = makeHost();
      expect(await request(host, { ...base, op: "replay", playerId: players[0] })).toEqual(replay);
      expect(topScriptErrors(db)[0]!.count).toBe(count);
    } finally { await host.close(); db.close(); log.mockRestore(); vi.unstubAllEnvs(); }
  }, 30000);
});
