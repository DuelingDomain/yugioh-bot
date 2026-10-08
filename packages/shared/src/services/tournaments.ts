import type Database from "better-sqlite3";
import type { Tournament as BaseTournament, TournamentMatch, TournamentPlayer, TournamentVisibility } from "../types/index.js";
import type { DuelBestOf } from "../duels/index.js";
import type { Match } from "./matches.js";
import { createScoringService } from "./scoring.js";
import {
  generateRoundRobin,
  generateSingleElimFirstRound,
  type TournamentPairing,
} from "../tournaments/formats.js";
import { generateWebSlug } from "../util/web-slug.js";
import { MAX_REPORT_CONFIRM_HOURS, MIN_REPORT_CONFIRM_HOURS } from "./constants.js";
import { createSeriesStore } from "./duel-series.js";
import { serializeTournamentDuelRules, TournamentDuelError } from "./tournament-duels.js";

export type TournamentFormat = "round_robin" | "single_elim";
export type TournamentStatus = "pending" | "active" | "cancelled" | "completed";

export type { TournamentMatch } from "../types/index.js";
/** A tournament with its match length (1 or 3 games per pairing). */
export type Tournament = BaseTournament & { bestOf: DuelBestOf };
export type TournamentParticipant = TournamentPlayer;

export type TournamentMatchStatus = "open" | "pending_approval" | "completed";

type AutocompleteInput = {
  guildId: string;
  query: string;
  statuses?: TournamentStatus[];
  createdByUserId?: number;
  participantPlayerId?: number;
};

function mapTournament(row: any): Tournament {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    format: row.format,
    status: row.status,
    visibility: row.visibility,
    createdByUserId: row.created_by_user_id,
    webSlug: row.web_slug ?? undefined,
    deadlineAt: row.deadline_at ?? undefined,
    reportConfirmWindowHours: row.report_confirm_window_hours ?? undefined,
    bestOf: row.best_of === 1 ? 1 : 3,
  };
}

function mapMatch(row: any): Match {
  return {
    id: row.id,
    guildId: row.guild_id,
    playerOneId: row.player_one_id,
    playerTwoId: row.player_two_id,
    winnerId: row.winner_id,
    reporterId: row.reporter_id,
    approverId: row.approver_id,
    status: row.status,
    source: row.source,
    tournamentId: row.tournament_id,
  };
}

function mapTournamentMatch(row: any): TournamentMatch {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    matchId: row.match_id,
    playerOneId: row.player_one_id,
    playerTwoId: row.player_two_id,
    roundNumber: row.round_number,
    status: row.status,
    metadata: JSON.parse(row.metadata_json),
  };
}

function assertBestOf(value: unknown): asserts value is DuelBestOf {
  if (value !== 1 && value !== 3) {
    throw new TournamentDuelError("Best of must be 1 or 3", 400);
  }
}

function assertFormat(format: string): asserts format is TournamentFormat {
  if (format !== "round_robin" && format !== "single_elim") {
    throw new Error("Unsupported tournament format");
  }
}

export function createTournamentService(db: Database.Database) {
  const findById = (tournamentId: number): Tournament => {
    const row = db.prepare("select * from tournaments where id = ?").get(tournamentId);

    if (!row) {
      throw new Error("Tournament not found");
    }

    return mapTournament(row);
  };

  const insertTournamentPairing = (
    tournamentId: number,
    pairing: TournamentPairing,
    status: TournamentMatchStatus = "open",
    metadata: Record<string, unknown> = {},
  ) => {
    db.prepare(
      `
      insert into tournament_matches (
        tournament_id,
        player_one_id,
        player_two_id,
        round_number,
        status,
        metadata_json
      )
      values (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      tournamentId,
      pairing.playerOneId,
      pairing.playerTwoId,
      pairing.roundNumber,
      status,
      JSON.stringify(metadata),
    );
  };

  const participantsFor = (tournamentId: number): number[] => {
    return db
      .prepare(
        `
        select player_id from tournament_participants
        where tournament_id = ?
        order by joined_at asc, player_id asc
      `,
      )
      .all(tournamentId)
      .map((row: any) => row.player_id);
  };

  const findTournamentMatchById = (tournamentMatchId: number): TournamentMatch => {
    const row = db.prepare("select * from tournament_matches where id = ?").get(tournamentMatchId);

    if (!row) {
      throw new Error("Tournament match not found");
    }

    return mapTournamentMatch(row);
  };

  const validateWindow = (hours: number | null | undefined) => {
    if (hours === null || hours === undefined) return;
    if (!Number.isInteger(hours) || hours < MIN_REPORT_CONFIRM_HOURS || hours > MAX_REPORT_CONFIRM_HOURS) {
      throw new Error(
        `Confirm window must be an integer between ${MIN_REPORT_CONFIRM_HOURS} and ${MAX_REPORT_CONFIRM_HOURS} hours`,
      );
    }
  };

  const selectOpenSeriesForSlot = db.prepare<[number], { id: number }>(
    "select id from duel_series where tournament_match_id = ? and status in ('active', 'between_games') limit 1",
  );
  const selectOpenSeriesOfTournament = db.prepare<[number], { id: number; guild_id: string }>(`
    select s.id, s.guild_id
    from duel_series s
    inner join tournament_matches tm on tm.id = s.tournament_match_id
    where tm.tournament_id = ? and s.status in ('active', 'between_games')
    order by s.id
  `);

  /** A manual report would race the series result, so the slot refuses it while a series is open. */
  const assertNoOpenSeries = (tournamentMatchId: number) => {
    if (selectOpenSeriesForSlot.get(tournamentMatchId)) {
      throw new TournamentDuelError(
        "This match is being played as an online duel series. The result records itself.",
        409,
      );
    }
  };

  /**
   * Cancels every open series of the tournament's matches and their lobby
   * games. Call inside the transaction that closes the tournament. A live game
   * keeps running but its result no longer counts; its slug is returned too so
   * the caller can notify. Returns the slugs of games that changed.
   */
  const cancelOpenSeries = (tournamentId: number): string[] => {
    const open = selectOpenSeriesOfTournament.all(tournamentId);
    if (open.length === 0) return [];
    const store = createSeriesStore(db);
    const slugs = new Set<string>();
    for (const series of open) {
      for (const slug of store.cancel(series.id, series.guild_id).changedSlugs) slugs.add(slug);
      const latest = store.latestGame(series.id)?.slug;
      if (latest) slugs.add(latest);
    }
    return [...slugs];
  };

  const insertPendingMatch = (
    tournament: Tournament,
    slotId: number,
    reporterId: number,
    opponentId: number,
    winnerId: number,
  ): Match => {
    const result = db
      .prepare(
        `
        insert into matches (
          guild_id,
          player_one_id,
          player_two_id,
          winner_id,
          reporter_id,
          status,
          source,
          tournament_id
        )
        values (?, ?, ?, ?, ?, 'pending', 'tournament', ?)
      `,
      )
      .run(tournament.guildId, reporterId, opponentId, winnerId, reporterId, tournament.id);

    const matchId = Number(result.lastInsertRowid);

    db.prepare(
      `
      update tournament_matches
      set match_id = ?, status = 'pending_approval'
      where id = ?
    `,
    ).run(matchId, slotId);

    return mapMatch(db.prepare("select * from matches where id = ?").get(matchId));
  };

  const reportTx = db.transaction(
    (tournamentId: number, reporterId: number, opponentId: number, winnerId: number): Match => {
      const tournament = findById(tournamentId);

      if (tournament.status !== "active") {
        throw new Error("Tournament is not active");
      }

      if (winnerId !== reporterId && winnerId !== opponentId) {
        throw new Error("Winner must be one of the match players");
      }

      const tournamentMatch = db
        .prepare(
          `
          select * from tournament_matches
          where tournament_id = ?
            and status = 'open'
            and (
              (player_one_id = ? and player_two_id = ?)
              or (player_one_id = ? and player_two_id = ?)
            )
          order by round_number asc, id asc
          limit 1
        `,
        )
        .get(tournamentId, reporterId, opponentId, opponentId, reporterId);

      if (!tournamentMatch) {
        throw new Error("Open tournament match not found");
      }

      assertNoOpenSeries((tournamentMatch as any).id);

      return insertPendingMatch(tournament, (tournamentMatch as any).id, reporterId, opponentId, winnerId);
    },
  );

  const reportTournamentMatchTx = db.transaction(
    (tournamentMatchId: number, reporterId: number, winnerId: number): Match => {
      const tournamentMatch = findTournamentMatchById(tournamentMatchId);
      const tournament = findById(tournamentMatch.tournamentId);

      if (tournament.status !== "active") {
        throw new Error("Tournament is not active");
      }

      if (tournamentMatch.status !== "open" || tournamentMatch.playerTwoId === null) {
        throw new Error("Tournament match is not open");
      }

      const playerIds = [tournamentMatch.playerOneId, tournamentMatch.playerTwoId];

      if (!playerIds.includes(reporterId)) {
        throw new Error("You are not in this tournament match");
      }

      if (!playerIds.includes(winnerId)) {
        throw new Error("Winner must be one of the match players");
      }

      assertNoOpenSeries(tournamentMatch.id);

      const opponentId =
        reporterId === tournamentMatch.playerOneId
          ? tournamentMatch.playerTwoId
          : tournamentMatch.playerOneId;

      return insertPendingMatch(tournament, tournamentMatch.id, reporterId, opponentId, winnerId);
    },
  );

  const cancelTx = db.transaction((tournamentId: number) => {
    const tournament = findById(tournamentId);

    if (tournament.status !== "pending" && tournament.status !== "active") {
      throw new Error(`Tournament cannot be cancelled in status '${tournament.status}'`);
    }

    db.prepare(
      "update tournaments set status = 'cancelled', ended_at = current_timestamp where id = ?",
    ).run(tournamentId);
    const changedDuelSlugs = cancelOpenSeries(tournamentId);

    return { tournament: findById(tournamentId), changedDuelSlugs };
  });

  const completeTx = db.transaction((tournamentId: number) => {
    const tournament = findById(tournamentId);

    if (tournament.status !== "active") {
      throw new Error(`Tournament cannot be completed in status '${tournament.status}'`);
    }

    db.prepare(
      "update tournaments set status = 'completed', ended_at = current_timestamp where id = ?",
    ).run(tournamentId);
    const changedDuelSlugs = cancelOpenSeries(tournamentId);

    return { tournament: findById(tournamentId), changedDuelSlugs };
  });

  const closeForDeadlineTx = db.transaction((tournamentId: number) => {
    const closed = db
      .prepare(
        "update tournaments set status = 'completed', ended_at = current_timestamp where id = ? and status = 'active'",
      )
      .run(tournamentId);
    const changedDuelSlugs = closed.changes > 0 ? cancelOpenSeries(tournamentId) : [];
    return { tournament: findById(tournamentId), changedDuelSlugs };
  });

  return {
    create(
      guildId: string,
      name: string,
      format: TournamentFormat,
      createdByUserId: number,
      options?: {
        visibility?: TournamentVisibility;
        deadlineAt?: string | null;
        reportConfirmWindowHours?: number | null;
        /** Games per pairing; default 3. */
        bestOf?: DuelBestOf;
        /** Online duel rules: { mode, masterRule, settings }. Default: a normal duel. */
        duelRules?: { mode?: unknown; masterRule?: unknown; settings?: unknown } | null;
      },
    ): Tournament {
      assertFormat(format);
      const visibility = options?.visibility ?? "private";
      if (visibility !== "open" && visibility !== "private") throw new Error("visibility must be open or private");
      validateWindow(options?.reportConfirmWindowHours);
      const bestOf = options?.bestOf ?? 3;
      assertBestOf(bestOf);
      const duelRulesJson = options?.duelRules ? serializeTournamentDuelRules(options.duelRules) : null;

      const existingCurrent = db
        .prepare(
          `
          select id from tournaments
          where guild_id = ?
            and name = ?
            and status in ('pending', 'active')
          limit 1
        `,
        )
        .get(guildId, name);

      if (existingCurrent) {
        throw new Error("An active or pending tournament already uses that name");
      }

      const insert = db.prepare(
        `
          insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug, deadline_at, report_confirm_window_hours, best_of, duel_rules_json, visibility)
          values (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
        `,
      );

      let result;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          result = insert.run(
            guildId,
            name,
            format,
            createdByUserId,
            generateWebSlug(),
            options?.deadlineAt ?? null,
            options?.reportConfirmWindowHours ?? null,
            bestOf,
            duelRulesJson,
            visibility,
          );
          break;
        } catch (err: any) {
          if (err?.code !== "SQLITE_CONSTRAINT_UNIQUE" || attempt === 4) throw err;
        }
      }

      return findById(Number(result!.lastInsertRowid));
    },

    findById,

    findByName(guildId: string, name: string): Tournament | undefined {
      const row = db
        .prepare(
          `
          select * from tournaments
          where guild_id = ? and name = ?
          order by
            case status when 'active' then 0 when 'pending' then 1 else 2 end,
            id desc
          limit 1
        `,
        )
        .get(guildId, name);

      return row ? mapTournament(row) : undefined;
    },

    listByStatus(guildId: string, statuses: TournamentStatus[]): Tournament[] {
      if (statuses.length === 0) {
        return [];
      }

      return db
        .prepare(
          `
          select * from tournaments
          where guild_id = ?
            and status in (${statuses.map(() => "?").join(", ")})
          order by created_at asc, id asc
        `,
        )
        .all(guildId, ...statuses)
        .map(mapTournament);
    },

    activeForPlayer(guildId: string, playerId: number): Tournament[] {
      return db
        .prepare(
          `
          select t.* from tournaments t
          inner join tournament_participants tp on tp.tournament_id = t.id
          where t.guild_id = ?
            and t.status = 'active'
            and tp.player_id = ?
          order by t.created_at asc, t.id asc
        `,
        )
        .all(guildId, playerId)
        .map(mapTournament);
    },

    forPlayer(guildId: string, playerId: number): Tournament[] {
      return db
        .prepare(
          `
          select t.* from tournaments t
          inner join tournament_participants tp on tp.tournament_id = t.id
          where t.guild_id = ?
            and tp.player_id = ?
            and t.status in ('pending', 'active')
          order by case t.status when 'active' then 0 else 1 end, t.created_at asc, t.id asc
        `,
        )
        .all(guildId, playerId)
        .map(mapTournament);
    },

    createdBy(guildId: string, createdByUserId: number, statuses: TournamentStatus[]): Tournament[] {
      if (statuses.length === 0) {
        return [];
      }

      return db
        .prepare(
          `
          select * from tournaments
          where guild_id = ?
            and created_by_user_id = ?
            and status in (${statuses.map(() => "?").join(", ")})
          order by created_at asc, id asc
        `,
        )
        .all(guildId, createdByUserId, ...statuses)
        .map(mapTournament);
    },

    autocomplete(input: AutocompleteInput): Tournament[] {
      const conditions = ["t.guild_id = ?", "lower(t.name) like lower(?)"];
      const params: Array<string | number> = [input.guildId, `%${input.query}%`];

      if (input.statuses && input.statuses.length > 0) {
        conditions.push(`t.status in (${input.statuses.map(() => "?").join(", ")})`);
        params.push(...input.statuses);
      }

      if (input.createdByUserId) {
        conditions.push("t.created_by_user_id = ?");
        params.push(input.createdByUserId);
      }

      if (input.participantPlayerId !== undefined) {
        conditions.push(
          `exists (
            select 1 from tournament_participants tp
            where tp.tournament_id = t.id and tp.player_id = ?
          )`,
        );
        params.push(input.participantPlayerId);
      }

      return db
        .prepare(
          `
          select t.* from tournaments t
          where ${conditions.join(" and ")}
          order by t.created_at asc, t.id asc
          limit 25
        `,
        )
        .all(...params)
        .map(mapTournament);
    },

    join(tournamentId: number, playerId: number): void {
      const tournament = findById(tournamentId);

      if (tournament.status !== "pending") {
        throw new Error("Tournament has already started");
      }

      const existing = db.prepare("select 1 from tournament_participants where tournament_id = ? and player_id = ?").get(tournamentId, playerId);

      if (existing) {
        throw new Error("You have already joined this tournament");
      }

      db.prepare(
        `
        insert into tournament_participants (tournament_id, player_id)
        values (?, ?)
      `,
      ).run(tournamentId, playerId);
    },

    participants(tournamentId: number): number[] {
      return participantsFor(tournamentId);
    },

    leave(tournamentId: number, playerId: number): void {
      const tournament = findById(tournamentId);

      if (tournament.status !== "pending") {
        throw new Error("Tournament has already started");
      }

      const result = db
        .prepare("delete from tournament_participants where tournament_id = ? and player_id = ?")
        .run(tournamentId, playerId);

      if (result.changes === 0) {
        throw new Error("You are not a participant in this tournament");
      }
    },

    kick(tournamentId: number, organizerUserId: number, playerId: number): void {
      const tournament = findById(tournamentId);

      if (tournament.status !== "pending") {
        throw new Error("Tournament has already started");
      }

      if (tournament.createdByUserId !== organizerUserId) {
        throw new Error("Only the organizer can kick participants");
      }

      const result = db
        .prepare("delete from tournament_participants where tournament_id = ? and player_id = ?")
        .run(tournamentId, playerId);

      if (result.changes === 0) {
        throw new Error("That player is not a participant in this tournament");
      }
    },

    participantCount(tournamentId: number): number {
      const row = db
        .prepare("select count(*) as c from tournament_participants where tournament_id = ?")
        .get(tournamentId) as { c: number };
      return row.c;
    },

    participantRecords(tournamentId: number): TournamentParticipant[] {
      return db
        .prepare(
          `
          select p.id as player_id, p.display_name
          from tournament_participants tp
          inner join players p on p.id = tp.player_id
          where tp.tournament_id = ?
          order by tp.joined_at asc, tp.rowid asc
        `,
        )
        .all(tournamentId)
        .map((row: any) => ({ playerId: row.player_id, displayName: row.display_name }));
    },

    start(tournamentId: number): Tournament {
      const tournament = findById(tournamentId);
      const playerIds = participantsFor(tournamentId);

      if (tournament.status !== "pending") {
        throw new Error("Tournament has already started");
      }

      if (playerIds.length < 2) {
        throw new Error("Tournament needs at least two players");
      }

      if (tournament.format === "round_robin") {
        for (const pairing of generateRoundRobin(playerIds)) {
          if (pairing.playerTwoId === null) {
            insertTournamentPairing(
              tournamentId,
              pairing,
              "completed",
              { bye: true, winnerId: pairing.playerOneId },
            );
          } else {
            insertTournamentPairing(tournamentId, pairing);
          }
        }
      }

      if (tournament.format === "single_elim") {
        const firstRound = generateSingleElimFirstRound(playerIds);

        for (const byePlayerId of firstRound.byes) {
          insertTournamentPairing(
            tournamentId,
            { playerOneId: byePlayerId, playerTwoId: null, roundNumber: 1 },
            "completed",
            { bye: true, winnerId: byePlayerId },
          );
        }

        for (const pairing of firstRound.pairings) {
          insertTournamentPairing(tournamentId, pairing);
        }
      }

      db.prepare(
        `
        update tournaments
        set status = 'active', started_at = current_timestamp
        where id = ?
      `,
      ).run(tournamentId);

      return findById(tournamentId);
    },

    matches(tournamentId: number): TournamentMatch[] {
      return db
        .prepare(
          `
          select * from tournament_matches
          where tournament_id = ?
          order by round_number asc, id asc
        `,
        )
        .all(tournamentId)
        .map(mapTournamentMatch);
    },

    openMatches(tournamentId: number): TournamentMatch[] {
      return db
        .prepare(
          `
          select * from tournament_matches
          where tournament_id = ?
            and status in ('open', 'pending_approval')
          order by round_number asc, id asc
        `,
        )
        .all(tournamentId)
        .map(mapTournamentMatch);
    },

    findTournamentMatchById,

    openMatchesForPlayer(tournamentId: number, playerId: number): TournamentMatch[] {
      return db
        .prepare(
          `
          select * from tournament_matches
          where tournament_id = ?
            and status = 'open'
            and (player_one_id = ? or player_two_id = ?)
          order by round_number asc, id asc
        `,
        )
        .all(tournamentId, playerId, playerId)
        .map(mapTournamentMatch);
    },

    stats(tournamentId: number, playerId: number): { wins: number; losses: number } {
      const wins = db
        .prepare(
          `
          select count(*) as count
          from matches
          where tournament_id = ?
            and status = 'approved'
            and winner_id = ?
        `,
        )
        .get(tournamentId, playerId) as { count: number };
      const losses = db
        .prepare(
          `
          select count(*) as count
          from matches
          where tournament_id = ?
            and status = 'approved'
            and winner_id != ?
            and (player_one_id = ? or player_two_id = ?)
        `,
        )
        .get(tournamentId, playerId, playerId, playerId) as { count: number };

      return { wins: wins.count, losses: losses.count };
    },

    /**
     * Records a pending manual report for the open slot of two players. Refused
     * (409) while an online duel series is open for that slot.
     */
    report(tournamentId: number, reporterId: number, opponentId: number, winnerId: number): Match {
      return reportTx(tournamentId, reporterId, opponentId, winnerId);
    },

    /** Same as `report`, for a known slot. */
    reportTournamentMatch(tournamentMatchId: number, reporterId: number, winnerId: number): Match {
      return reportTournamentMatchTx(tournamentMatchId, reporterId, winnerId);
    },

    reopenTournamentMatch(tournamentMatchId: number, requesterUserId: number): void {
      const tm = db
        .prepare("select * from tournament_matches where id = ?")
        .get(tournamentMatchId) as
        | { id: number; tournament_id: number; match_id: number | null; status: string }
        | undefined;
      if (!tm) {
        throw new Error("Tournament match not found");
      }

      const tournament = findById(tm.tournament_id);
      if (tournament.createdByUserId !== requesterUserId) {
        throw new Error("Only the organizer can reopen a match");
      }
      if (tournament.format !== "round_robin") {
        throw new Error("Reopening results is only available for round-robin events");
      }
      if (tm.status !== "completed" || tm.match_id === null) {
        throw new Error("Match is not completed");
      }

      db.transaction(() => {
        const result = db.prepare("select status from matches where id=?").get(tm.match_id) as { status: string };
        const scored = db.prepare("select 1 from point_awards where match_id=? and kind='match_win'").get(tm.match_id);
        db.prepare(
          "update matches set status = 'denied', resolved_at = current_timestamp where id = ?",
        ).run(tm.match_id);

        db.prepare(
          "update tournament_matches set status = 'open', match_id = null where id = ?",
        ).run(tm.id);

        db.prepare(
          "update tournaments set status = 'active', ended_at = null where id = ? and status = 'completed'",
        ).run(tm.tournament_id);
        if (result.status === "approved" || scored) {
          createScoringService(db).rebuildStandings(tournament.guildId, { reopenedTournamentId: tm.tournament_id });
        }
      })();
    },

    cancel(tournamentId: number): Tournament {
      return cancelTx(tournamentId).tournament;
    },

    /**
     * Cancels the tournament and, in the same transaction, every open duel
     * series of its matches. `changedDuelSlugs` are the games to notify.
     */
    cancelWithChanges(tournamentId: number): { tournament: Tournament; changedDuelSlugs: string[] } {
      return cancelTx(tournamentId);
    },

    complete(tournamentId: number): Tournament {
      return completeTx(tournamentId).tournament;
    },

    /** Like `complete`; also cancels open duel series and returns the games to notify. */
    completeWithChanges(tournamentId: number): { tournament: Tournament; changedDuelSlugs: string[] } {
      return completeTx(tournamentId);
    },

    /**
     * Deadline and report window only. Match length and duel rules change
     * through the tournament duel service (`setRules`), which refuses them
     * once a game has started.
     */
    updateSettings(
      tournamentId: number,
      patch: {
        deadlineAt?: string | null;
        reportConfirmWindowHours?: number | null;
      },
    ): Tournament {
      const tournament = findById(tournamentId);

      if (tournament.status === "completed" || tournament.status === "cancelled") {
        throw new Error(`Cannot edit settings of a ${tournament.status} tournament`);
      }

      if ("reportConfirmWindowHours" in patch) {
        validateWindow(patch.reportConfirmWindowHours);
      }

      const sets: string[] = [];
      const params: Array<string | number | null> = [];
      if ("deadlineAt" in patch) {
        sets.push("deadline_at = ?");
        params.push(patch.deadlineAt ?? null);
      }
      if ("reportConfirmWindowHours" in patch) {
        sets.push("report_confirm_window_hours = ?");
        params.push(patch.reportConfirmWindowHours ?? null);
      }

      if (sets.length > 0) {
        params.push(tournamentId);
        db.prepare(`update tournaments set ${sets.join(", ")} where id = ?`).run(...params);
      }

      return findById(tournamentId);
    },

    closeForDeadline(tournamentId: number): Tournament {
      return closeForDeadlineTx(tournamentId).tournament;
    },

    /** Like `closeForDeadline`; also returns the duel games to notify. */
    closeForDeadlineWithChanges(tournamentId: number): { tournament: Tournament; changedDuelSlugs: string[] } {
      return closeForDeadlineTx(tournamentId);
    },

    findOverdueActive(now: string): Tournament[] {
      return db
        .prepare(
          `
          select * from tournaments
          where status = 'active'
            and deadline_at is not null
            and deadline_at <= ?
          order by id asc
        `,
        )
        .all(now)
        .map(mapTournament);
    },
  };
}

export type TournamentService = ReturnType<typeof createTournamentService>;
