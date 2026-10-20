import Database from "better-sqlite3";
import { dbPath, duelDataDir, guildId } from "../stack/env.mjs";
import { createDuelService } from "@yugidraft/shared/services";
import { defaultDuelSettings, seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame } from "../../duel-server/src/engine.js";
import { getCurrentEngineResources } from "../../duel-server/src/engine-resource-resolver.js";
import { chooseSurrenderedAnswer } from "../../duel-server/src/practice-bot.js";

export interface ReplayFixture {
  slug: string; format: DuelFormat; commands: number; journalBytes: number; snapshotBytes: number; readMs: number;
}

/** Play real engine commands and save all final projections in this E2E slot's SQLite. */
export async function createReplayFixture(format: DuelFormat, maxCommands: number, visibility: "public" | "private" = "public", damage = false): Promise<ReplayFixture> {
  const db = new Database(dbPath);
  const service = createDuelService(db);
  const ids = db.prepare("select id from players where guild_id=? order by id").all(guildId) as { id: number }[];
  const playerIds = ids.map((row: { id: number }) => row.id);
  try {
    const count = seatCountFor(format);
    const resources = getCurrentEngineResources(duelDataDir, { mode: "normal", format, engine: "pinned" });
    const settings = { ...defaultDuelSettings("normal"), visibility, validateDeck: false, shuffleDeck: false, turnSeconds: 0 };
    const decks = Array.from({ length: count }, () => ({ main: [...Array(damage ? 5 : 0).fill(19523799), ...Array(damage ? 195 : 200).fill(46986414)], extra: [], side: [] }));
    const seed = ["1", "2", "3", "4"];
    const game = await createEngineGame({ mode: "normal", masterRule: 5, format, decks, seed, settings, firstTurnDraw: false,
      scriptErrorMode: "strict", dataDirectory: duelDataDir });
    try {
      return db.transaction(() => {
        const session = service.create({ guildId, organizerPlayerId: playerIds[0]!, name: `Replay timing ${format}`, mode: "normal", format, settings });
        db.prepare("delete from duel_seats where duel_id=?").run(session.id);
        for (let seat = 0; seat < count; seat++) db.prepare("insert into duel_seats(duel_id,seat,player_id,ready,deck_json) values(?,?,?,1,?)")
          .run(session.id, seat, playerIds[seat], JSON.stringify(decks[seat]));
        db.prepare("update duels set status='active',seed_json=?,bundle_version=?,setup_json=? where id=?").run(
          JSON.stringify(seed), resources.bundleVersion, JSON.stringify({ engine: "pinned", firstTurnDraw: false, scriptErrorMode: "strict", engineIdentity: resources.identity }), session.id);
        const max = maxCommands;
        for (let step = 0; step < max; step++) {
          const view = Array.from({ length: count }, (_, seat) => game.view(seat)).find(view => view.prompt);
          if (!view?.prompt) break;
          const prompt = view.prompt;
          const burn = damage && prompt.kind === "choice" ? prompt.options.find(option => option.id.startsWith("activate:") && option.card?.code === 19523799) : undefined;
          const answer = burn ? { choice: burn.id } : chooseSurrenderedAnswer(prompt);
          const command = { revision: view.revision, promptId: prompt.id, answer };
          game.answer(prompt.seat, prompt.id, answer);
          service.recordCommand(session.slug, guildId, prompt.seat, command, null);
        }
        const snapshots = { public: game.view(null), seats: Array.from({ length: count }, (_, seat) => game.view(seat)) };
        if (snapshots.public.result) service.complete(session.slug, guildId, snapshots.public.result.winnerSeat, snapshots.public.result.reason, snapshots);
        else service.interrupt(session.slug, guildId, "Replay measurement end", snapshots);
        // Exercise the required current-engine verification of a saved older replay.
        db.prepare("update duels set bundle_version='previous-bundle' where id=?").run(session.id);
        const at = performance.now();
        const state = service.privateState(session.slug, guildId);
        const readMs = performance.now() - at;
        const snapshot = db.prepare("select length(snapshot_public_json)+coalesce(length(snapshot_seat0_json),0)+coalesce(length(snapshot_seat1_json),0)+coalesce(length(snapshot_seats_json),0) as bytes from duels where id=?").get(session.id) as { bytes: number };
        return { slug: session.slug, format, commands: state.commands.length, journalBytes: Buffer.byteLength(JSON.stringify(state.commands)), snapshotBytes: snapshot.bytes, readMs };
      }).immediate();
    } finally { game.close(); }
  } finally { db.close(); }
}
