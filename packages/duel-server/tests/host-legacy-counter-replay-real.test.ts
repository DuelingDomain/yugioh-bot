import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { signedRequestHeaders } from "@yugidraft/shared/internal-auth";
import { defaultDuelSettings, type DuelEngineView, type DuelReplayV2, type ReplayForkResult } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { getCurrentEngineResources } from "../src/engine-resource-resolver.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { seedIdentity } from "./helpers/identity.js";

const EXEMPLAR = 6061630, POT = 55144522;
const secret = "legacy-counter-replay", guildId = "legacy-counter-replay";

describeWithCores("legacy saved counter replay", [needs.cards(DATA), needs.scripts(DATA), needs.standard(DATA)], () => {
  it.each(["legacy", "pinned"] as const)("only permits the old lossy layout for %s reconstruction", async engine => {
    vi.stubEnv("OWNER_USER_IDS", "101");
    const db = new Database(":memory:"); migrate(db);
    let host: DuelHost | undefined;
    const settings = { ...defaultDuelSettings("normal"), shuffleDeck: false, validateDeck: false,
      stopAtEveryWindow: false, turnSeconds: 0 };
    const deck = { main: Array.from({ length: 20 }, (_, index) => index % 2 ? POT : EXEMPLAR), extra: [], side: [] };
    const seed = ["1", "2", "3", "4"];
    const game = await (engine === "legacy" ? createLegacyEngineGame : createEngineGame)({ mode: "normal", format: "1v1",
      dataDirectory: DATA, decks: [deck, deck], seed, settings, firstTurnDraw: false, scriptErrorMode: "strict" });
    try {
      for (const [playerId, userId] of [[201, 101], [202, 102]]) seedIdentity(db, { guildId, playerId, userId });
      const service = createDuelService(db), session = service.create({ guildId, organizerPlayerId: 201,
        name: "Saved counter fixture", mode: "normal", settings });
      db.prepare("delete from duel_seats where duel_id=?").run(session.id);
      for (const seat of [0, 1]) db.prepare("insert into duel_seats(duel_id,seat,player_id,ready,deck_json) values(?,?,?,1,?)")
        .run(session.id, seat, seat + 201, JSON.stringify(deck));
      const original = getCurrentEngineResources(DATA, { mode: "normal", format: "1v1", engine });
      db.prepare("update duels set status='active',seed_json=?,bundle_version=?,setup_json=? where id=?")
        .run(JSON.stringify(seed), original.bundleVersion, JSON.stringify({ engine, firstTurnDraw: false,
          scriptErrorMode: "strict", engineIdentity: original.identity }), session.id);
      const hasCounters = (view: DuelEngineView) => view.seats.some(seat => seat.monsters.some(card => card?.counters?.some(counter => counter.count === 2)));
      for (let step = 0; step < 30 && !hasCounters(game.view(null)); step++) {
        const view = [0, 1].map(seat => game.view(seat)).find(view => view.prompt)!;
        expect(view, `command ${step}`).toBeDefined();
        const prompt = view.prompt!, hasExemplar = view.seats[prompt.seat].monsters.some(card => card?.code === EXEMPLAR);
        const action = prompt.kind === "choice" ? prompt.options.find(option => hasExemplar
          ? option.id.startsWith("activate:") && option.card?.code === POT
          : option.id.startsWith("summon:") && option.card?.code === EXEMPLAR) : undefined;
        const answer = action ? { choice: action.id } : chooseSurrenderedAnswer(prompt);
        const command = { revision: view.revision, promptId: prompt.id, answer };
        game.answer(prompt.seat, prompt.id, answer);
        service.recordCommand(session.slug, guildId, prompt.seat, command, null);
      }
      const views = [game.view(null), game.view(0), game.view(1)];
      expect(hasCounters(views[0])).toBe(true);
      for (const view of views) for (const seat of view.seats) for (const card of seat.monsters) {
        if (card?.counters) card.counters = card.counters.map(({ type, count }) => ({ type: count, count: type }));
      }
      service.interrupt(session.slug, guildId, "Counter fixture ended", { public: views[0], seats: views.slice(1) });
      // This reproduces the wrapper identity change introduced by the corrected decoder.
      db.prepare("update duels set bundle_version=?,setup_json=json_set(setup_json,'$.engineIdentity.wrapperHash',?) where id=?")
        .run("old-counter-wrapper", "0".repeat(64), session.id);
      host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000 });
      async function post<T>(input: Record<string, unknown>, status = 200): Promise<T> {
        const raw = JSON.stringify({ guildId, playerId: 201, userId: 101, slug: session.slug, ...input });
        const response = await host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
          headers: signedRequestHeaders({ url: "http://localhost/internal/duel", method: "POST", body: raw, secret, purpose: "duel-host" }) }));
        const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(status); return body as T;
      }
      if (engine === "pinned") {
        expect(await post({ op: "replay", version: 2 }, 409)).toMatchObject({ code: "REPLAY_UNVERIFIED", reason: "board_mismatch" });
      } else {
        expect(await post({ op: "replay", version: 2 })).toMatchObject({ verification: "verified" });
        const replay = await post<DuelReplayV2>({ op: "owner-replay" });
        const checkpoint = replay.frames.find(frame => frame.cursor !== null)!;
        expect(checkpoint).toBeDefined();
        const fork = await post<ReplayForkResult>({ op: "replay-fork", cursor: checkpoint.cursor,
          sourceVersion: replay.sourceVersion, requestId: "legacy-counters" });
        expect(fork.room.session).toMatchObject({ kind: "replay-fork", status: "active" });
        const saved = JSON.parse((db.prepare("select snapshot_public_json from duels where id=?").get(session.id) as { snapshot_public_json: string }).snapshot_public_json);
        saved.seats[0].lp--;
        db.prepare("update duels set snapshot_public_json=? where id=?").run(JSON.stringify(saved), session.id);
        expect(await post({ op: "replay", version: 2 }, 409)).toMatchObject({ code: "REPLAY_UNVERIFIED", reason: "board_mismatch" });
      }
    } finally { await host?.close(); game.close(); db.close(); vi.unstubAllEnvs(); }
  }, 30_000);
});
