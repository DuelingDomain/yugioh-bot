import { createHmac } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { seatCountFor, type DuelDeck } from "@yugidraft/shared/duels";
import { MULTIPLAYER_FORBIDDEN } from "../src/banlists/multiplayer.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { createDuelHost } from "../src/host.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "domain-card-restriction-test";
const DARK_MAGICIAN = 46986414;
const CYBER_DRAGON = 70095154;
const ELF = 15025844;
const MACHINE = 7359741;

function legalDeck(seat: number): DuelDeck {
  const cards = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const forbidden = new Set(MULTIPLAYER_FORBIDDEN.map((card) => card.code));
    const spells = cards.prepare("SELECT id FROM datas WHERE type=2 AND alias=0 AND ot&3!=0 ORDER BY id").all() as { id: number }[];
    return { main: [seat < 2 ? ELF : MACHINE, ...spells.map((card) => card.id).filter((code) => !forbidden.has(code)).slice(0, 59)], extra: [], side: [], deckMaster: seat < 2 ? DARK_MAGICIAN : CYBER_DRAGON };
  } finally { cards.close(); }
}

const cases = (["ffa3", "ffa4", "tag"] as const).flatMap((format) => Array.from({ length: seatCountFor(format) }, (_, seat) => ({ format, seat })));

describeWithCores("live Domain card restriction at every multiplayer seat", needs.domainMulti(DATA), () => {
  it.each(cases)("$format refuses a card outside the Deck Master Domain of seat $seat, then starts a real duel after repair", async ({ format, seat }) => {
    const db = new Database(":memory:");
    migrate(db);
    const count = seatCountFor(format);
    const players = Array.from({ length: count }, (_, index) => Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", `u${index}`, `P${index}`).lastInsertRowid));
    const service = createDuelService(db);
    const room = service.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Domain restriction proof", mode: "domain", format, settings: { banlist: "none", validateDeck: true, shuffleDeck: false, turnSeconds: 0 } });
    for (const player of players.slice(1)) service.takeSeat(room.slug, "g1", player);
    let game: EngineGame | undefined;
    let creates = 0;
    const worker: DuelGameWorker = {
      get running() { return game !== undefined; },
      async create(options) { creates++; game = await createEngineGame({ ...options, seed: ["1", "2", "3", "4"] }); },
      async view(viewer) { return game!.view(viewer); },
      async answer(actor, id, answer) { game!.answer(actor, id, answer); },
      async eliminate(actor, reason) { game!.eliminate(actor, reason); },
      async search(query) { return game!.searchCards(query); },
      async close() { game?.close(); game = undefined; },
    };
    const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker });
    const post = async (player: number, body: Record<string, unknown>) => {
      const raw = JSON.stringify({ slug: room.slug, guildId: "g1", playerId: player, ...body });
      const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
      const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", headers: { "content-type": "application/json", "x-announce-signature": signature }, body: raw }));
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    try {
      const decks = players.map((_, index) => legalDeck(index));
      // These monsters fit the other Deck Master, but not the submitting seat's own Deck Master.
      const outside = seat < 2 ? 89631139 : 70781052; // Blue-Eyes White Dragon / Summoned Skull
      const invalid = { ...decks[seat]!, main: [outside, ...decks[seat]!.main.slice(1)] };
      for (let index = 0; index < count; index++) {
        const result = await post(players[index]!, { op: "deck", deck: index === seat ? invalid : decks[index] });
        expect(result.status, JSON.stringify(result.body)).toBe(index === seat ? 400 : 200);
        if (index === seat) expect(result.body.error).toMatch(/outside the Deck Master's Domain/);
      }
      expect(service.get(room.slug, "g1").seats.map((member) => member.ready)).toEqual(players.map((_, index) => index !== seat));
      expect((await post(players[0]!, { op: "start" })).status).toBe(409);
      expect(creates).toBe(0);
      service.setDeck(room.slug, "g1", players[seat]!, invalid);
      const refused = await post(players[0]!, { op: "start" });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/outside the Deck Master's Domain/);
      expect(creates).toBe(0);
      expect(service.get(room.slug, "g1").status).toBe("lobby");
      expect((await post(players[seat]!, { op: "deck", deck: decks[seat] })).status).toBe(200);
      expect((await post(players[0]!, { op: "start" })).status).toBe(200);
      expect(creates).toBe(1);
      expect(game!.coreInfo().wasmFile).toBe("ocgcore.multi-domain.wasm");
      const prompt = game!.view(0).prompt!;
      const summon = prompt.options.find((option) => option.id.startsWith("summon:") && option.card?.code === ELF)!;
      expect(summon).toBeDefined();
      game!.answer(0, prompt.id, { choice: summon.id });
      for (let step = 0; step < 30; step++) {
        const open = players.map((_, index) => game!.view(index).prompt).find((item) => item !== null && item !== undefined);
        if (!open || open.context?.type === "action") break;
        if (open.cancelable) game!.answer(open.seat, open.id, { cancel: true });
        else game!.answer(open.seat, open.id, open.kind === "places" || open.kind === "cards" ? { selected: [open.options[0]!.id] } : { choice: open.options[0]!.id });
      }
      for (let index = 0; index < count; index++) {
        const member = game!.view(index).seats[index]!;
        expect(member.lp).toBe(format === "tag" ? 16000 : 8000);
        expect(member.monsters.filter(Boolean).map((card) => card!.code)).toEqual(index === 0 ? [ELF] : []);
        expect(member.spells.filter(Boolean)).toEqual([]);
        expect(member.graveyard).toEqual([]);
        expect(member.banished).toEqual([]);
        expect(member.hand).toHaveLength(5);
        expect(member.deckMaster).toMatchObject({ card: { code: decks[index]!.deckMaster }, inZone: true, returns: 0, nextCost: 0 });
      }
      expect(game!.view(0).prompt?.context?.type).toBe("action");
    } finally { await host.close(); db.close(); }
  }, 30_000);
});
