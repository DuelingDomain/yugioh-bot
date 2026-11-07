import type Database from "better-sqlite3";
import { readRemoteState } from "../remote/storage.js";
import { createRemoteDuelService } from "./remote-duels.js";
import { resolveTournamentDuelRules } from "./tournament-duels.js";
import { assertRemoteTournamentEntrants, assertRemoteTournamentFormat, assertRemoteTournamentUser, TournamentRemoteError } from "./tournament-remote-access.js";

/** Creates the room and its reservation under one write lock. No engine/deck registration path. */
export function createTournamentRemoteService(db: Database.Database) {
  return {
    startMatch(input: { guildId: string; tournamentId: number; tournamentMatchId: number; actorUserId: number; maxLiveRooms?: number }) {
      return db.transaction(() => {
        const tournament = db.prepare("select * from tournaments where id=? and guild_id=?").get(input.tournamentId, input.guildId) as
          { id: number; status: string; duel_type: string; best_of: number; duel_rules_json: string | null } | undefined;
        if (!tournament) throw new TournamentRemoteError("Tournament not found", 404, "TOURNAMENT_NOT_FOUND");
        const slot = db.prepare(`select tm.*, p1.user_id as user_one_id, p2.user_id as user_two_id,
          p1.display_name as name_one, p2.display_name as name_two
          from tournament_matches tm join players p1 on p1.id=tm.player_one_id
          left join players p2 on p2.id=tm.player_two_id
          where tm.id=? and tm.tournament_id=? and p1.guild_id=? and (p2.guild_id=? or p2.id is null)`)
          .get(input.tournamentMatchId, tournament.id, input.guildId, input.guildId) as
          { id: number; player_one_id: number; player_two_id: number | null; status: string; user_one_id: number; user_two_id: number | null; name_one: string; name_two: string } | undefined;
        if (!slot) throw new TournamentRemoteError("Tournament match not found", 404, "TOURNAMENT_MATCH_NOT_FOUND");
        if (input.actorUserId !== slot.user_one_id && input.actorUserId !== slot.user_two_id) {
          throw new TournamentRemoteError("Only the paired players can start this Remote Duel", 403, "REMOTE_MATCH_PLAYER_REQUIRED");
        }
        if (tournament.duel_type !== "remote") throw new TournamentRemoteError("This tournament uses online duels", 409, "WRONG_DUEL_TYPE");
        assertRemoteTournamentUser(input.actorUserId);
        if (tournament.status !== "active") throw new TournamentRemoteError("Tournament is not active", 409, "TOURNAMENT_NOT_ACTIVE");
        if (slot.player_two_id === null || slot.status !== "open") {
          throw new TournamentRemoteError("Tournament match is unavailable", 409, "TOURNAMENT_MATCH_UNAVAILABLE");
        }
        assertRemoteTournamentEntrants(db, tournament.id, [slot.player_one_id, slot.player_two_id]);
        const rules = resolveTournamentDuelRules({ ...tournament, draft_id: null });
        assertRemoteTournamentFormat(rules);
        const result = db.prepare("select status from tournament_remote_matches where tournament_match_id=?").get(slot.id) as { status: string } | undefined;
        if (result && result.status !== "playing" && result.status !== "void") {
          throw new TournamentRemoteError("This pairing has an outstanding Remote result", 409, "TOURNAMENT_MATCH_UNAVAILABLE");
        }
        const remote = createRemoteDuelService(db);
        const existing = db.prepare("select slug from remote_tables where tournament_match_id=? and status!='ended'").get(slot.id) as { slug: string } | undefined;
        if (existing) {
          const table = remote.tournamentTable(existing.slug, input.guildId, input.actorUserId);
          return { table, created: false };
        }
        // B3 will capture the proposal at table end. Until then a winner still blocks replay.
        const last = db.prepare("select state_json from remote_tables where tournament_match_id=? order by id desc limit 1").get(slot.id) as { state_json: string } | undefined;
        if (last && readRemoteState(db, last.state_json).match?.winnerSeat != null && result?.status !== "void") {
          throw new TournamentRemoteError("This pairing has a finished Remote result", 409, "TOURNAMENT_MATCH_UNAVAILABLE");
        }
        const room = remote.create({ guildId: input.guildId, userId: input.actorUserId,
          displayName: input.actorUserId === slot.user_one_id ? slot.name_one : slot.name_two,
          gameId: "ygo", seatCount: 2, bestOf: rules.bestOf, format: "normal",
          rules: { ...rules.settings, visibility: "private" }, visibility: "private", maxLiveRooms: input.maxLiveRooms });
        const tableId = (db.prepare("select id from remote_tables where slug=?").get(room.slug) as { id: number }).id;
        db.prepare("update remote_tables set tournament_match_id=? where id=?").run(slot.id, tableId);
        // A no-result room/replay resets the single per-slot record; B3 blocks unresolved proposals.
        db.prepare("delete from tournament_remote_matches where tournament_match_id=?").run(slot.id);
        const now = Date.now();
        db.prepare(`insert into tournament_remote_matches(tournament_match_id,table_id,table_slug,player_one_id,player_two_id,created_at,updated_at)
          values(?,?,?,?,?,?,?)`).run(slot.id, tableId, room.slug, slot.player_one_id, slot.player_two_id, now, now);
        return { table: remote.tournamentTable(room.slug, input.guildId, input.actorUserId), created: true };
      }).immediate();
    },
  };
}
