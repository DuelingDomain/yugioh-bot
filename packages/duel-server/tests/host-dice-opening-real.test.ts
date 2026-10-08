import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelRoom, DuelReplay } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";

const SECRET = "real-dice-host";
const resources: Array<{ host: DuelHost; db: Database.Database }> = [];
afterEach(async () => {
  for (const { host, db } of resources.splice(0)) { await host.close(); db.close(); }
  vi.unstubAllEnvs();
});

describeWithCores("FFA dice order with real workers, recovery and replay", [needs.cards(DATA), needs.installedMulti(DATA)], () => {
  it.each(["ffa3", "ffa4"] as const)("%s starts the rolled player in seat 0 and keeps that order on recovery and replay", async (format) => {
    vi.stubEnv("MULTIPLAYER_TABLES", "1");
    const db = new Database(":memory:"); migrate(db);
    const duels = createDuelService(db);
    const count = format === "ffa3" ? 3 : 4;
    const players = Array.from({ length: count }, (_, i) => seedIdentity(db, {
      guildId: "g", name: `P${i}`, ...seedUser(db, `u${i}`),
    }).playerId);
    const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Real dice", mode: "normal", format,
      settings: { validateDeck: false, shuffleDeck: false, turnSeconds: 0, stopAtEveryWindow: false } });
    const codes = [15025844, 48305365, 46986414, 89631139];
    for (let seat = 0; seat < count; seat++) {
      if (seat) duels.takeSeat(session.slug, "g", players[seat]!, seat);
      duels.setDeck(session.slug, "g", players[seat]!, { main: Array(40).fill(codes[seat]), extra: [], side: [] });
    }
    let at = 1000;
    const dice = [2, 1, 6, 4];
    const workers: GameWorker[] = [];
    const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], now: () => at,
      rollDie: () => dice.shift()!, pollIntervalMs: 60_000,
      createWorker: () => { const worker = new GameWorker(); workers.push(worker); return worker; } });
    resources.push({ host, db });
    const post = async (op: string, playerId = players[2]!, extra: Record<string, unknown> = {}) => {
      const raw = JSON.stringify({ op, guildId: "g", slug: session.slug, playerId, ...extra });
      const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
        headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
      expect(response.status, await response.clone().text()).toBe(200);
      return await response.json() as DuelRoom & DuelReplay;
    };
    expect((await post("start", players[0]!)).opening?.phase).toBe("dice");
    at = 3999;
    expect((await post("view")).session.status).toBe("lobby");
    at = 4000;
    const first = await post("view");
    expect(first).toMatchObject({ mySeat: 0, session: { status: "active" }, engine: { turnSeat: 0, prompt: { seat: 0 } } });
    expect(first.engine!.seats[0]!.hand.every((card) => card.code === codes[2])).toBe(true);
    const prompt = first.engine!.prompt!;
    expect(prompt.options.some((option) => option.id === "to_ep")).toBe(true);
    const answered = await post("respond", players[2]!, { command: {
      promptId: prompt.id, revision: first.engine!.revision, answer: { choice: "to_ep" },
    } });
    await workers[0]!.close();
    const recovered = await post("view");
    expect(recovered.mySeat).toBe(0);
    expect(recovered.engine).toEqual(answered.engine);
    duels.interrupt(session.slug, "g", "Test done");
    const replay = await post("replay");
    expect(replay.mySeat).toBe(0);
    expect(replay.frames[0]!.view.turnSeat).toBe(0);
    expect(replay.frames[0]!.view.seats).toEqual(first.engine!.seats);
    expect(replay.frames[1]!.actorSeat).toBe(0);
  }, 60_000);
});
