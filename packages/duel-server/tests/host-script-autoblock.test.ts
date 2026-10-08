import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { emptyCardQuery, type DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { pinnedEngineVersion } from "../src/multi-scripts.js";
import { topScriptErrors } from "../src/script-error-store.js";
import { clearAutoBlock } from "../src/script-error-autoblock.js";
import { reproOptions, attackAnswer } from "./helpers/script-error-repro.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const secret = "auto-block-test";
async function request(host: DuelHost, body: Record<string, unknown>, status = 200): Promise<any> {
  const raw = JSON.stringify(body);
  const response = await host.handle(new Request("http://local/internal/duel", { method: "POST", body: raw,
    headers: { "content-type": "application/json", "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
  const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(status); return result;
}
describeWithCores("automatic blocks through live host and replay", [needs.standard(DATA)], () => {
  it.each(["legacy", "pinned"] as const)("%s: blocks new duels and deck checks while live/recovered/replayed state stays identical", async engine => {
    vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_DUELS", "1");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new Database(":memory:"); migrate(db);
    const players = [0, 1].map(i => seedIdentity(db, { guildId: "g", name: `P${i}`, userId: seedUser(db, `auto${i}`).userId }).playerId);
    const duels = createDuelService(db), options = reproOptions();
    const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Existing", mode: "normal", settings: options.settings });
    duels.takeSeat(session.slug, "g", players[1]!);
    players.forEach((player, seat) => duels.setDeck(session.slug, "g", player, options.decks[seat]!));
    const version = JSON.parse(readFileSync(`${DATA}/manifest.json`, "utf8")).bundleVersion;
    duels.activate(session.slug, "g", players[0]!, options.seed, pinnedEngineVersion(version, 2, null), null,
      { engine, scriptErrorMode: "tolerant", firstTurnDraw: false, startupScripts: options.startupScripts!.map(script => script.content) });
    const makeHost = () => createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60000 });
    let host = makeHost();
    const base = { slug: session.slug, guildId: "g" };
    const views = (): Promise<DuelEngineView[]> => Promise.all(players.map(async playerId => (await request(host, { ...base, op: "view", playerId })).engine));
    try {
      for (let step = 0; step < 80; step++) {
        const current = await views(); if (current[0]!.events.some(event => event.kind === "script-error")) break;
        const seat = current.findIndex(view => view.prompt !== null), view = current[seat]!;
        await request(host, { ...base, op: "respond", playerId: players[seat], command: { promptId: view.prompt!.id, revision: view.revision, answer: attackAnswer(view.prompt!) } });
      }
      const live = await views(), journal = duels.privateState(session.slug, "g").commands;
      const count = topScriptErrors(db)[0]!.count;
      expect(count).toBeGreaterThan(0);
      expect(db.prepare("SELECT code FROM card_script_auto_blocks WHERE cleared_at IS NULL").all()).toEqual([{ code: 3743515 }]);
      const blockedDeck = { ...options.decks[0]!, main: [3743515, ...options.decks[0]!.main] };
      const check = await request(host, { op: "check-deck", guildId: "g", playerId: players[0], mode: "normal", deck: blockedDeck, settings: options.settings });
      expect(check.report.issues[0].message).toContain("is unavailable: Its effect script is being investigated");
      const query = await request(host, { op: "card-query", guildId: "g", playerId: players[0], cardQuery: { ...emptyCardQuery(), text: "3743515" } });
      expect(query.cards[0].unavailableReason).toBe("Its effect script is being investigated");
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
