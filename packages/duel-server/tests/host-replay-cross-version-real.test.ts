import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { defaultDuelSettings, seatCountFor, type DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { getCurrentEngineResources } from "../src/engine-resource-resolver.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { GameWorker } from "../src/worker-client.js";
import { seedIdentity } from "./helpers/identity.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

// Without DUEL_REPLAY_SOURCE_DATA_DIR, CI checks a changed label in one prepared bundle.
// Set it to a second prepared source bundle to require different identities and verify the
// original version without relabeling it. See docs/deployment/engine-data-updates.md.
const TWO_BUNDLES = process.env.DUEL_REPLAY_SOURCE_DATA_DIR !== undefined;
const SOURCE_DATA = resolve(process.env.DUEL_REPLAY_SOURCE_DATA_DIR ?? DATA);
const POT_OF_GREED = 55144522;
const secret = "real-cross-version-fixture", guildId = "real-replay-fixture";

describeWithCores(TWO_BUNDLES ? "real cross-version replay (two bundles)" : "real cross-version replay (single-bundle label check)",
  [needs.cards(DATA), needs.scripts(DATA, `official/c${POT_OF_GREED}.lua`), needs.standard(DATA),
  needs.installedMulti(DATA), needs.cards(SOURCE_DATA), needs.scripts(SOURCE_DATA, `official/c${POT_OF_GREED}.lua`), needs.standard(SOURCE_DATA),
  needs.installedMulti(SOURCE_DATA), needs.file("engine manifest", join(DATA, "manifest.json"))], () => {
  it.each([
    { format: "1v1", unknown: false, label: "recorded pinned 1v1" },
    { format: "ffa3", unknown: false, label: "recorded multi FFA3" },
    { format: "1v1", unknown: true, label: "unknown 1v1 choice on legacy" },
  ] as const)("verifies a live $label win and refuses an edited final board", async ({ format, unknown }) => {
    const db = new Database(":memory:"); migrate(db);
    let host: DuelHost | undefined;
    try {
      const count = seatCountFor(format), players = Array.from({ length: count }, (_, seat) => 201 + seat);
      for (const playerId of players) seedIdentity(db, { guildId, userId: String(playerId), playerId });
      const service = createDuelService(db), session = service.create({ guildId,
        organizerPlayerId: players[0]!, name: "Live replay fixture", mode: "normal", format,
        settings: { ...defaultDuelSettings("normal"), visibility: "private", shuffleDeck: false,
          validateDeck: false, stopAtEveryWindow: false, turnSeconds: 0, startingHand: 5 } });
      // Seat rows bypass invite admission; all subsequent commands run through the live host.
      db.prepare("delete from duel_seats where duel_id=?").run(session.id);
      for (const [seat, playerId] of players.entries()) db.prepare(
        "insert into duel_seats(duel_id,seat,player_id,is_bot,ready,deck_json) values(?,?,?,0,1,?)")
        .run(session.id, seat, playerId, JSON.stringify({ main: Array(20).fill(POT_OF_GREED), extra: [], side: [] }));
      const original = getCurrentEngineResources(SOURCE_DATA, { mode: "normal", format, engine: "pinned" });
      db.prepare("update duels set status='active',seed_json=?,bundle_version=?,setup_json=? where id=?")
        .run(JSON.stringify(["1", "2", "3", "4"]), original.bundleVersion,
          JSON.stringify({ engine: "pinned", firstTurnDraw: false, scriptErrorMode: "strict", engineIdentity: original.identity }), session.id);
      host = createDuelHost({ db, dataDirectory: SOURCE_DATA, secret, searchCards: () => [], pollIntervalMs: 60_000 });
      const post = async (input: Record<string, unknown>) => {
        const raw = JSON.stringify({ slug: session.slug, guildId, playerId: players[0], ...input });
        const response = await host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
          headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
        return { status: response.status, body: await response.json() as any };
      };
      let room = await post({ op: "view" });
      expect(room.status, JSON.stringify(room.body)).toBe(200);
      const activated = new Set<number>(), resolvedDraws = new Set<number>();
      for (let move = 0; move < 100 && room.body.session.status === "active"; move++) {
        const publicView = (await post({ op: "view", playerId: players[0] })).body.engine as DuelEngineView;
        const seat = publicView.prioritySeat ?? publicView.turnSeat;
        const own = await post({ op: "view", playerId: players[seat] });
        const view = own.body.engine as DuelEngineView, prompt = view.prompt;
        expect(prompt, `No prompt at move ${move}`).not.toBeNull();
        const effect = prompt!.kind === "choice" ? prompt!.options.find(option =>
          option.id.startsWith("activate:") && option.card?.code === POT_OF_GREED) : undefined;
        if (effect) activated.add(seat);
        const answer = effect ? { choice: effect.id } : chooseSurrenderedAnswer(prompt!);
        room = await post({ op: "respond", playerId: players[seat], command: {
          revision: view.revision, promptId: prompt!.id, answer } });
        expect(room.status, JSON.stringify(room.body)).toBe(200);
        // A two-card draw in Main Phase proves the Lua operation ran, beyond script loading.
        if (view.phase === "main1") for (const before of view.seats) {
          if (room.body.engine.seats[before.seat].deckCount === before.deckCount - 2) resolvedDraws.add(before.seat);
        }
      }
      expect(room.body.session.status).toBe("completed");
      expect([...activated].sort()).toEqual(players.map((_, seat) => seat));
      expect([...resolvedDraws].sort()).toEqual(players.map((_, seat) => seat));
      const saved = service.privateState(session.slug, guildId);
      expect(saved.commands.length).toBeGreaterThan(8);
      expect(saved.session.winnerSeat).not.toBeNull();
      expect(room.body.engine.result).toMatchObject({ winnerSeat: saved.session.winnerSeat });
      // persistComplete captured the original live final projections, before any replay build.
      const board = db.prepare("select snapshot_public_json,snapshot_seats_json,snapshot_seat0_json,snapshot_seat1_json from duels where id=?").get(session.id) as any;
      expect(JSON.parse(board.snapshot_public_json).result).toEqual(room.body.engine.result);
      if (format === "1v1") {
        expect(JSON.parse(board.snapshot_seat0_json).result).toEqual(room.body.engine.result);
        expect(JSON.parse(board.snapshot_seat1_json).result).toEqual(room.body.engine.result);
      } else expect(JSON.parse(board.snapshot_seats_json)).toHaveLength(count);
      expect(await post({ op: "replay", version: 2 })).toMatchObject({ status: 200, body: { verification: "exact" } });
      await host.close();
      const current = getCurrentEngineResources(DATA, { mode: "normal", format, engine: "pinned" });
      if (TWO_BUNDLES) expect(current.identity, "Second-bundle mode requires distinct engine identities").not.toEqual(original.identity);
      host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000 });
      const sourceBundleVersion = TWO_BUNDLES ? original.bundleVersion : "older-live-fixture-label";
      if (!TWO_BUNDLES) db.prepare("update duels set bundle_version=? where id=?").run(sourceBundleVersion, session.id);
      const families: Array<string | undefined> = [];
      if (unknown) {
        db.prepare("update duels set setup_json=json_remove(setup_json,'$.engine','$.engineIdentity') where id=?").run(session.id);
        await host.close();
        host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000,
          createWorker: () => {
            const worker = new GameWorker(), create = worker.create.bind(worker);
            worker.create = options => { families.push(options.engine); return create(options); };
            return worker;
          } });
      }
      expect(await post({ op: "replay", version: 2 })).toMatchObject({ status: 200, body: { verification: "verified" } });
      expect(db.prepare("select result,reason from duel_replay_verifications where duel_id=?").get(session.id))
        .toEqual({ result: "verified", reason: null });
      if (unknown) {
        // This pinned-made journal also verifies on legacy. It does not prove a legacy failure followed by a pinned pass.
        expect(families).toEqual(["legacy"]);
        expect(db.prepare("select core_family from duel_replay_verifications where duel_id=?").get(session.id)).toEqual({ core_family: "legacy" });
        // A different projection builds directly on the persisted family.
        expect((await post({ op: "replay", version: 2, visibility: "public" })).status).toBe(200);
        expect(families).toEqual(["legacy", "legacy"]);
      }
      const changed = JSON.parse(board.snapshot_public_json); changed.seats[0].lp--;
      db.prepare("update duels set snapshot_public_json=? where id=?").run(JSON.stringify(changed), session.id);
      expect(await post({ op: "replay", version: 2 })).toMatchObject({ status: 409, body: {
        code: "REPLAY_UNVERIFIED", reason: "board_mismatch" } });
      expect(db.prepare("select result,reason from duel_replay_verifications where duel_id=?").get(session.id))
        .toEqual({ result: "unverified", reason: "board_mismatch" });
      if (unknown) expect(families).toEqual(["legacy", "legacy", "legacy", "pinned"]);
      expect(service.privateState(session.slug, guildId).bundleVersion).toBe(sourceBundleVersion);
    } finally { await host?.close(); db.close(); }
  }, 30_000);
});
