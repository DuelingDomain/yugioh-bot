import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import type { DuelEngineView, SandboxRun } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker } from "../src/worker-client.js";
import { resolveCard } from "../src/presets/catalog.js";
import { chooseScripted } from "../src/scripted-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const POS_FACEDOWN = 0x0a;
const resources: Array<{ host: DuelHost; db: Database.Database }> = [];
afterEach(async () => {
  for (const { host, db } of resources.splice(0)) { await host.close(); db.close(); }
});
const run: SandboxRun = { bots: { "1": "manual", "2": "manual", "3": "manual" }, seed: ["1", "2", "3", "4"] };

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const owner = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', 'owner', 'owner')").run().lastInsertRowid);
  const workers: GameWorker[] = [];
  const host = createDuelHost({ db, dataDirectory: DATA, secret: "s", searchCards: () => [],
    botStepDelayMs: 0, pollIntervalMs: 3_600_000, idleWorkerMs: 3_600_000, stallMs: 0, queueBlockedMs: 0,
    createWorker: () => { const worker = new GameWorker(); workers.push(worker); return worker; } });
  resources.push({ db, host });
  async function post(op: string, extra: Record<string, unknown> = {}) {
    const raw = JSON.stringify({ guildId: "g", playerId: owner, op, ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", "s").update(raw).digest("hex") } }));
    return { status: response.status, data: await response.json() as any };
  }
  return { workers, post };
}

/** Starts at Main Phase 1 of p0's first turn with the given cards Set in p0's Spell and Trap Zones. */
async function startWithSet(spells: number[]) {
  const t = setup();
  const elf = resolveCard("Mystical Elf", DATA);
  const board = { startAt: "main1", p0: { spells: spells.map((card) => ({ card, pos: "set" })), grave: [elf] },
    p1: { monsters: [elf, elf], spells: [{ card: spells[0], pos: "set" }] } };
  const started = await t.post("start-sandbox", { board, run });
  expect(started.status, started.data.error).toBe(200);
  return { ...t, slug: started.data.slug as string, elf };
}

describeWithCores("sandbox Set Spell/Trap cards in a real core", [needs.cards(DATA), needs.standard(DATA)], () => {
  it("keeps Dark Hole face-down, offers its activation to p0, and the activation destroys monsters", async () => {
    const dark = resolveCard("Dark Hole", DATA);
    const t = await startWithSet([dark]);
    const view = await t.workers[0].view(0);
    expect(view.phase).toBe("main1");
    expect(view.turnSeat).toBe(0);
    expect(view.seats[0].spells[0]).toMatchObject({ code: dark, position: POS_FACEDOWN });
    // The opponent never sees the identity of a Set card.
    const opposing = await t.workers[0].view(1);
    expect(opposing.seats[0].spells[0]).toMatchObject({ position: POS_FACEDOWN });
    expect(opposing.seats[0].spells[0]?.code).toBeUndefined();

    const activate = view.prompt?.options.find((option) => option.id.startsWith("activate:") && option.card?.code === dark);
    expect(activate, JSON.stringify(view.prompt?.options)).toBeTruthy();
    const sent = await t.post("respond", { slug: t.slug, command: { promptId: view.prompt!.id, revision: view.revision, answer: { choice: activate!.id } } });
    expect(sent.status, sent.data.error).toBe(200);

    let now: DuelEngineView = await t.workers[0].view(0);
    for (let step = 0; step < 40 && now.seats[1].monsters.some(Boolean); step++) {
      const mine = [0, 1].map((seat) => ({ seat, view: undefined as DuelEngineView | undefined }));
      for (const entry of mine) entry.view = await t.workers[0].view(entry.seat);
      const current = mine.find((entry) => entry.view?.prompt);
      expect(current?.view?.prompt, JSON.stringify(now.log)).toBeTruthy();
      const prompt = current!.view!.prompt!;
      await t.workers[0].answer(prompt.seat, prompt.id, chooseScripted([], prompt, current!.view!, { seat: prompt.seat }).answer);
      now = await t.workers[0].view(0);
    }
    expect(now.seats[1].monsters.filter(Boolean)).toHaveLength(0);
    expect(now.seats[0].spells[0]).toBeNull();
  }, 30_000);

  it("lets a Set Quick-Play Spell and a Set Normal Trap respond on the turn the board placed them", async () => {
    const mst = resolveCard("Mystical Space Typhoon", DATA);
    const call = resolveCard("Call of the Haunted", DATA);
    const t = await startWithSet([mst, call]);
    const view = await t.workers[0].view(0);
    // The start walk stops at the first window where a Set card can respond (here the Draw Phase), so the
    // options are chain choices ("card:N"), not Main Phase "activate:N" actions. Both prove the card is live.
    const activatable = view.prompt?.options.filter((option) => /^(activate|card):/.test(option.id)).map((option) => option.card?.code);
    expect(activatable).toEqual(expect.arrayContaining([mst, call]));
  }, 30_000);
});
