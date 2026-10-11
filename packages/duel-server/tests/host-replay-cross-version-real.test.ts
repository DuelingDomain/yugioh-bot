import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { runJournalPrefix } from "../src/journal-runner.js";
import { GameWorker } from "../src/worker-client.js";
import { seedIdentity } from "./helpers/identity.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { acceptanceSource } from "./support/replay-acceptance.js";

describeWithCores("real cross-version replay", [needs.cards(DATA), needs.scripts(DATA), needs.standard(DATA),
  needs.file("engine manifest", join(DATA, "manifest.json"))], () => {
  it("verifies public and private final boards after only the recorded bundle label changes", async () => {
    const { source, resources } = acceptanceSource({ mode: "normal", format: "1v1", engine: "pinned" });
    const db = new Database(":memory:"); migrate(db);
    let host: DuelHost | undefined, worker: GameWorker | undefined;
    try {
      for (const seat of source.session.seats) seedIdentity(db, { guildId: source.session.guildId, userId: seat.playerId!, playerId: seat.playerId! });
      const service = createDuelService(db), session = service.create({ guildId: source.session.guildId,
        organizerPlayerId: source.session.seats[0]!.playerId!, name: "Real replay fixture", mode: "normal", settings: source.session.settings });
      service.takeSeat(session.slug, session.guildId, source.session.seats[1]!.playerId!, 1);
      for (const seat of source.session.seats) db.prepare("update duel_seats set deck_json=?,ready=1 where duel_id=? and seat=?")
        .run(JSON.stringify(source.decks[seat.seat]), session.id, seat.seat);
      db.prepare("update duels set status='active',seed_json=?,bundle_version=?,setup_json=? where id=?")
        .run(JSON.stringify(source.seed), source.bundleVersion, JSON.stringify({ ...source.setup, engineIdentity: source.engineIdentity }), session.id);
      for (const entry of source.commands) db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,?,?,?)")
        .run(session.id, entry.storedSeq, entry.seat, JSON.stringify(entry.command));
      const rebuilt = await runJournalPrefix({ source, resources, prefixCount: source.commands.length,
        createWorker: () => (worker = new GameWorker()) });
      service.interrupt(session.slug, session.guildId, source.session.resultReason!, rebuilt.views);
      await worker!.close(); worker = undefined;
      const secret = "real-cross-version-fixture";
      host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000 });
      const replay = async () => {
        const raw = JSON.stringify({ op: "replay", slug: session.slug, guildId: session.guildId,
          playerId: source.session.seats[0]!.playerId, version: 2 });
        const response = await host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
          headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
        const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body;
      };
      expect((await replay()).verification).toBe("exact");
      db.prepare("update duels set bundle_version='older-fixture-label' where id=?").run(session.id);
      expect((await replay()).verification).toBe("verified");
      expect(db.prepare("select result,reason from duel_replay_verifications where duel_id=?").get(session.id)).toEqual({ result: "verified", reason: null });
      expect(db.prepare("select bundle_version from duels where id=?").get(session.id)).toEqual({ bundle_version: "older-fixture-label" });
    } finally { await worker?.close(); await host?.close(); db.close(); }
  }, 30_000);
});
