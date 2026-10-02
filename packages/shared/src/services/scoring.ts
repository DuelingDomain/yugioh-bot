import type Database from "better-sqlite3";
import { ELO_DEFAULT, SEASON_MULTIPLIER_DEFAULT } from "../scoring/constants.js";
import { nextRating } from "../scoring/elo.js";
import { matchWinPoints, placementPoints, sizeMultiplier } from "../scoring/winnings.js";
import { evaluateAchievements } from "../scoring/achievements.js";
import { rankForRating } from "../scoring/rank.js";
import { createSeasonService } from "./seasons.js";

type PointAward = {
  id: number | null;
  guild_id: string;
  season_id: number;
  player_id: number;
  kind: string;
  placement: "champion" | "runnerUp" | "top4" | null;
  match_id: number | null;
  tournament_id: number | null;
  points: number;
  opponent_elo: number | null;
  size_multiplier: number | null;
  created_at: string;
};

export type RebuildOptions = {
  recoverMissing?: boolean;
  /** A just-reopened approved result invalidates its completion bonuses too. */
  reopenedTournamentId?: number;
};

type ReplayMatch = {
  id: number;
  player_one_id: number;
  player_two_id: number;
  winner_id: number | null;
  tournament_id: number | null;
  status: string;
  scored_at: string;
};

type ReplaySlot = {
  tournament_id: number;
  match_id: number | null;
  player_two_id: number | null;
  status: string;
};

function ratingOf(db: Database.Database, guildId: string, playerId: number): number {
  const row = db
    .prepare("select elo from player_ratings where guild_id = ? and player_id = ?")
    .get(guildId, playerId) as { elo: number } | undefined;
  return row?.elo ?? ELO_DEFAULT;
}

function upsertRating(
  db: Database.Database,
  guildId: string,
  playerId: number,
  patch: { elo?: number; addWinnings?: number; bestStreak?: number },
) {
  db.prepare(
    `insert into player_ratings (guild_id, player_id, elo, career_winnings, best_streak_alltime)
     values (?, ?, ?, ?, ?)
     on conflict(guild_id, player_id) do update set
       elo = coalesce(?, player_ratings.elo),
       career_winnings = player_ratings.career_winnings + ?,
       best_streak_alltime = max(player_ratings.best_streak_alltime, ?)`,
  ).run(
    guildId,
    playerId,
    patch.elo ?? ELO_DEFAULT,
    patch.addWinnings ?? 0,
    patch.bestStreak ?? 0,
    patch.elo ?? null,
    patch.addWinnings ?? 0,
    patch.bestStreak ?? 0,
  );
}

function bumpStanding(
  db: Database.Database,
  guildId: string,
  seasonId: number,
  playerId: number,
  patch: { addWinnings?: number; win?: boolean; loss?: boolean },
) {
  db.prepare(
    `insert into season_standings (guild_id, season_id, player_id, winnings, wins, losses, current_streak, best_streak)
     values (?, ?, ?, 0, 0, 0, 0, 0)
     on conflict(season_id, player_id) do nothing`,
  ).run(guildId, seasonId, playerId);

  if (patch.addWinnings) {
    db.prepare("update season_standings set winnings = winnings + ? where season_id = ? and player_id = ?")
      .run(patch.addWinnings, seasonId, playerId);
  }
  if (patch.win) {
    db.prepare(
      `update season_standings
       set wins = wins + 1,
           current_streak = current_streak + 1,
           best_streak = max(best_streak, current_streak + 1)
       where season_id = ? and player_id = ?`,
    ).run(seasonId, playerId);
  }
  if (patch.loss) {
    db.prepare(
      "update season_standings set losses = losses + 1, current_streak = 0 where season_id = ? and player_id = ?",
    ).run(seasonId, playerId);
  }
}

export function createScoringService(db: Database.Database) {
  const seasons = createSeasonService(db);

  const refreshAchievements = (guildId: string, playerId: number) => {
    const rating = db
      .prepare("select career_winnings from player_ratings where guild_id=? and player_id=?")
      .get(guildId, playerId) as { career_winnings: number } | undefined;
    const best = db
      .prepare(
        "select coalesce(max(best_streak),0) as b from season_standings where guild_id=? and player_id=?",
      )
      .get(guildId, playerId) as { b: number };
    const titles = db
      .prepare(
        `select count(*) as c from point_awards where guild_id=? and player_id=? and placement='champion'`,
      )
      .get(guildId, playerId) as { c: number };
    const beatTop = db
      .prepare(
        "select coalesce(max(unlocked_at),'') as u from player_achievements where guild_id=? and player_id=? and achievement_key='giant_slayer'",
      )
      .get(guildId, playerId) as { u: string };

    const keys = evaluateAchievements({
      careerWinnings: rating?.career_winnings ?? 0,
      bestStreak: best.b,
      tournamentTitles: titles.c,
      beatTopRanked: beatTop.u !== "",
    });
    const ins = db.prepare(
      "insert or ignore into player_achievements (guild_id, player_id, achievement_key) values (?, ?, ?)",
    );
    for (const k of keys) ins.run(guildId, playerId, k);
  };

  const recordMatchResult = (matchId: number): void => {
    const match = db.prepare("select * from matches where id = ?").get(matchId) as any;
    if (!match || match.status !== "approved" || match.winner_id == null) return;

    // idempotency — if a match_win award already exists, do nothing
    const existing = db
      .prepare("select 1 from point_awards where match_id = ? and kind='match_win'")
      .get(matchId);
    if (existing) return;

    const guildId = match.guild_id as string;
    const season = seasons.ensureActive(guildId);
    const winnerId = match.winner_id as number;
    const loserId = winnerId === match.player_one_id ? match.player_two_id : match.player_one_id;

    const tx = db.transaction(() => {
      const winnerElo = ratingOf(db, guildId, winnerId);
      const loserElo = ratingOf(db, guildId, loserId);

      const points = matchWinPoints({
        myElo: winnerElo,
        oppElo: loserElo,
        seasonMultiplier: SEASON_MULTIPLIER_DEFAULT,
      });

      // detect top-ranked upset for giant_slayer achievement
      const top = db
        .prepare("select player_id from player_ratings where guild_id=? order by elo desc limit 1")
        .get(guildId) as { player_id: number } | undefined;
      const beatTop = top && top.player_id === loserId && loserElo > winnerElo;

      upsertRating(db, guildId, winnerId, { elo: nextRating(winnerElo, loserElo, 1), addWinnings: points });
      upsertRating(db, guildId, loserId, { elo: nextRating(loserElo, winnerElo, 0) });

      const tm = db
        .prepare("select tournament_id from tournament_matches where match_id = ?")
        .get(matchId) as { tournament_id: number } | undefined;

      db.prepare(
        `insert into point_awards (guild_id, season_id, player_id, kind, match_id, tournament_id, points, opponent_elo)
         values (?, ?, ?, 'match_win', ?, ?, ?, ?)`,
      ).run(guildId, season.id, winnerId, matchId, tm?.tournament_id ?? null, points, loserElo);

      bumpStanding(db, guildId, season.id, winnerId, { addWinnings: points, win: true });
      bumpStanding(db, guildId, season.id, loserId, { loss: true });

      if (beatTop) {
        db.prepare(
          "insert or ignore into player_achievements (guild_id, player_id, achievement_key) values (?, ?, 'giant_slayer')",
        ).run(guildId, winnerId);
      }
      refreshAchievements(guildId, winnerId);
    });
    tx();
  };

  const participantCount = (tournamentId: number): number => {
    const row = db.prepare("select count(*) as c from tournament_participants where tournament_id = ?").get(tournamentId) as { c: number };
    return row.c;
  };

  // placement may be provided by the caller (it knows the bracket) or derived from tournament_matches wins
  const derivePlacement = (tournamentId: number): { champion?: number; runnerUp?: number; top4: number[] } => {
    const rows = db.prepare(
      `select m.winner_id as pid, count(*) as wins
       from tournament_matches tm join matches m on m.id = tm.match_id
       where tm.tournament_id = ? and tm.status='completed' and m.status='approved' and m.winner_id is not null
       group by m.winner_id order by wins desc`,
    ).all(tournamentId) as Array<{ pid: number; wins: number }>;
    return {
      champion: rows[0]?.pid,
      runnerUp: rows[1]?.pid,
      top4: rows.slice(2, 4).map((r) => r.pid),
    };
  };

  const recordTournamentResult = (
    tournamentId: number,
    placement?: { champion?: number; runnerUp?: number; top4: number[] },
  ): void => {
    const tournament = db.prepare("select * from tournaments where id = ?").get(tournamentId) as any;
    if (!tournament) return;
    const guildId = tournament.guild_id as string;
    const season = seasons.ensureActive(guildId);
    const place = placement ?? derivePlacement(tournamentId);
    const n = participantCount(tournamentId);

    const award = (playerId: number | undefined, tier: "champion" | "runnerUp" | "top4") => {
      if (playerId == null) return;
      const points = placementPoints(tier, n);
      const inserted = db.prepare(
        `insert or ignore into point_awards (guild_id, season_id, player_id, kind, placement, tournament_id, points, size_multiplier)
         values (?, ?, ?, 'placement', ?, ?, ?, ?)`,
      ).run(guildId, season.id, playerId, tier, tournamentId, points, sizeMultiplier(n));
      if (inserted.changes === 1) {
        upsertRating(db, guildId, playerId, { addWinnings: points });
        bumpStanding(db, guildId, season.id, playerId, { addWinnings: points });
        refreshAchievements(guildId, playerId);
      }
    };

    const tx = db.transaction(() => {
      award(place.champion, "champion");
      award(place.runnerUp, "runnerUp");
      for (const p of place.top4) award(p, "top4");
    });
    tx();
  };

  const getLeaderboard = (guildId: string, scope: "season" | "all") => {
    const season = seasons.getActive(guildId);
    const rows = scope === "season" && season
      ? db.prepare(
          `select ss.player_id, p.display_name, ss.winnings, ss.wins, ss.losses, ss.current_streak,
                  coalesce(pr.elo, 1000) as elo
           from season_standings ss
           join players p on p.id = ss.player_id
           left join player_ratings pr on pr.guild_id = ss.guild_id and pr.player_id = ss.player_id
           where ss.season_id = ?
           order by ss.winnings desc, ss.wins desc, p.display_name asc`,
        ).all(season.id)
      : db.prepare(
          `select pr.player_id, p.display_name, pr.career_winnings as winnings,
                  0 as wins, 0 as losses, 0 as current_streak, pr.elo as elo
           from player_ratings pr join players p on p.id = pr.player_id
           where pr.guild_id = ? order by pr.career_winnings desc, p.display_name asc`,
        ).all(guildId);

    return (rows as any[]).map((r) => {
      const rank = rankForRating(r.elo);
      const total = r.wins + r.losses;
      return {
        playerId: r.player_id,
        displayName: r.display_name,
        winnings: r.winnings,
        rating: r.elo,
        rank: rank.name,
        currentStreak: r.current_streak,
        wins: r.wins,
        losses: r.losses,
        winRate: total ? Math.round((r.wins / total) * 100) : 0,
      };
    });
  };

  const getProfile = (guildId: string, playerId: number, scope: "season" | "all") => {
    const season = seasons.getActive(guildId);
    const rating = db.prepare("select * from player_ratings where guild_id=? and player_id=?")
      .get(guildId, playerId) as any;
    const standing = season
      ? db.prepare("select * from season_standings where season_id=? and player_id=?").get(season.id, playerId) as any
      : undefined;
    const player = db.prepare("select display_name from players where id=?").get(playerId) as { display_name: string };
    const elo = rating?.elo ?? 1000;
    const rank = rankForRating(elo);
    const achievements = db.prepare("select achievement_key, unlocked_at from player_achievements where guild_id=? and player_id=?")
      .all(guildId, playerId) as Array<{ achievement_key: string; unlocked_at: string }>;
    const recent = db.prepare(
      `select pa.kind, pa.points, pa.created_at, pa.tournament_id, t.name as tournament_name
       from point_awards pa left join tournaments t on t.id = pa.tournament_id
       where pa.guild_id=? and pa.player_id=? order by pa.id desc limit 10`,
    ).all(guildId, playerId);

    const useSeason = scope === "season" && standing;
    return {
      playerId,
      displayName: player.display_name,
      rating: elo,
      rank,
      winnings: useSeason ? standing.winnings : (rating?.career_winnings ?? 0),
      careerWinnings: rating?.career_winnings ?? 0,
      wins: useSeason ? standing.wins : 0,
      losses: useSeason ? standing.losses : 0,
      currentStreak: useSeason ? standing.current_streak : 0,
      bestStreak: useSeason ? standing.best_streak : (rating?.best_streak_alltime ?? 0),
      achievements,
      recent,
    };
  };

  // Existing ledger IDs capture scoring order, including delayed approvals and
  // clock corrections. Recovery is an explicit maintenance choice only.
  const rebuildStandingsTx = db.transaction((guildId: string, options: RebuildOptions): void => {
    const ledger = db.prepare("select * from point_awards where guild_id=? order by id")
      .all(guildId) as PointAward[];
    const history = db.prepare(
      "select *, datetime(coalesce(resolved_at, created_at)) as scored_at from matches where guild_id=? order by id",
    ).all(guildId) as ReplayMatch[];
    const matches = new Map(history.map((m) => [m.id, m]));
    const approved = history.filter((m) => m.status === "approved" && m.winner_id !== null);
    const slots = db.prepare(
      `select tm.* from tournament_matches tm join tournaments t on t.id=tm.tournament_id
       where t.guild_id=? order by tm.id`,
    ).all(guildId) as ReplaySlot[];
    const tournamentForMatch = new Map<number, number>();
    const slotsByTournament = new Map<number, ReplaySlot[]>();
    for (const slot of slots) {
      if (slot.match_id !== null) tournamentForMatch.set(slot.match_id, slot.tournament_id);
      const group = slotsByTournament.get(slot.tournament_id) ?? [];
      group.push(slot);
      slotsByTournament.set(slot.tournament_id, group);
    }
    const tournaments = db.prepare(
      "select id, format, status, datetime(coalesce(ended_at, created_at)) as completed_at from tournaments where guild_id=?",
    ).all(guildId) as Array<{ id: number; format: string; status: string; completed_at: string }>;
    const counts = db.prepare(
      `select tp.tournament_id, count(*) as n from tournament_participants tp
       join tournaments t on t.id=tp.tournament_id where t.guild_id=? group by tp.tournament_id`,
    ).all(guildId) as Array<{ tournament_id: number; n: number }>;
    const participantCounts = new Map(counts.map((r) => [r.tournament_id, r.n]));
    const oldAchievements = db.prepare("select player_id, achievement_key, unlocked_at from player_achievements where guild_id=?")
      .all(guildId) as Array<{ player_id: number; achievement_key: string; unlocked_at: string }>;
    const unlockTimes = new Map(oldAchievements.map((a) => [`${a.player_id}:${a.achievement_key}`, a.unlocked_at]));
    const seasonHistory = db.prepare("select id, datetime(started_at) as started_at from seasons where guild_id=? order by datetime(started_at) desc, id desc")
      .all(guildId) as Array<{ id: number; started_at: string }>;
    const seasonAt = (time: string): number => {
      const season = seasonHistory.find((s) => s.started_at <= time) ?? seasonHistory.at(-1);
      if (season) return season.id;
      const created = seasons.ensureActive(guildId);
      seasonHistory.push({ id: created.id, started_at: created.startedAt });
      return created.id;
    };

    const invalidated = new Set<number>();
    if (options.reopenedTournamentId !== undefined) invalidated.add(options.reopenedTournamentId);
    const placementsByTournament = new Map<number, PointAward[]>();
    let events: PointAward[] = [];
    for (const award of ledger) {
      if (award.kind === "placement" && award.tournament_id !== null) {
        const group = placementsByTournament.get(award.tournament_id) ?? [];
        group.push(award);
        placementsByTournament.set(award.tournament_id, group);
      }
      if (award.kind === "match_win") {
        const match = award.match_id === null ? undefined : matches.get(award.match_id);
        if (!match || match.status !== "approved" || match.winner_id === null) {
          // A denied pending report has no award and never enters this branch.
          const tournamentId = award.tournament_id ?? match?.tournament_id;
          if (tournamentId != null) invalidated.add(tournamentId);
          continue;
        }
      }
      events.push(award);
    }

    // Explicit recovery reconciles completion bonuses even when final-match
    // scoring failed and a legacy reopen left no denied match award to find.
    const invalidatedRoundRobins = new Set(tournaments
      .filter((t) => t.format === "round_robin" && (options.recoverMissing || invalidated.has(t.id))).map((t) => t.id));
    events = events.filter((a) => a.kind !== "placement" || !invalidatedRoundRobins.has(a.tournament_id!));
    for (const tournament of tournaments) {
      if (tournament.format !== "round_robin" && tournament.format !== "single_elim") continue;
      const regenerate = invalidatedRoundRobins.has(tournament.id);
      if (!regenerate && !options.recoverMissing) continue;
      const previous = placementsByTournament.get(tournament.id) ?? [];
      if (tournament.status !== "completed") continue;
      if (previous.length === 0 && !options.recoverMissing) continue;
      const tournamentSlots = slotsByTournament.get(tournament.id) ?? [];
      // Recovery requires complete recorded history; byes never earn match points.
      if (tournamentSlots.length === 0 || tournamentSlots.some((s) => s.status !== "completed" ||
        (s.player_two_id !== null && (s.match_id === null || matches.get(s.match_id)?.status !== "approved")))) continue;
      const wins = new Map<number, number>();
      for (const slot of tournamentSlots) {
        const winner = slot.match_id === null ? null : matches.get(slot.match_id)?.winner_id;
        if (winner != null) wins.set(winner, (wins.get(winner) ?? 0) + 1);
      }
      // Same win-count placement rule as live tournament scoring, including ties.
      const ranked = [...wins].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([p]) => p);
      const desired: Array<[number, NonNullable<PointAward["placement"]>]> = ranked.slice(0, 4)
        .map((p, i) => [p, i === 0 ? "champion" : i === 1 ? "runnerUp" : "top4"]);
      const available = [...previous];
      const n = participantCounts.get(tournament.id) ?? 0;
      for (const [playerId, tier] of desired) {
        if (!regenerate && previous.some((a) => a.player_id === playerId)) continue;
        const index = available.findIndex((a) => a.player_id === playerId && a.placement === tier);
        const tierIndex = index >= 0 ? index : available.findIndex((a) => a.placement === tier);
        const original = regenerate ? available.splice(tierIndex < 0 ? 0 : tierIndex, 1)[0] : undefined;
        if (regenerate && !original && !options.recoverMissing) continue;
        const template = original ?? previous[0];
        // Placement seasons are authoritative, never inferred from match awards.
        events.push({ id: original?.id ?? null, guild_id: guildId,
          season_id: template?.season_id ?? seasonAt(tournament.completed_at), player_id: playerId,
          kind: "placement", placement: tier, match_id: null, tournament_id: tournament.id,
          points: placementPoints(tier, n), opponent_elo: null, size_multiplier: sizeMultiplier(n),
          created_at: template?.created_at ?? tournament.completed_at });
      }
    }

    if (options.recoverMissing) {
      const scoredIds = new Set(events.filter((a) => a.kind === "match_win").map((a) => a.match_id));
      for (const match of approved) {
        if (scoredIds.has(match.id)) continue;
        events.push({ id: null, guild_id: guildId, season_id: seasonAt(match.scored_at),
          player_id: match.winner_id!, kind: "match_win", placement: null, match_id: match.id,
          tournament_id: tournamentForMatch.get(match.id) ?? null, points: 0,
          opponent_elo: null, size_multiplier: null, created_at: match.scored_at });
      }
    }
    const recorded = events.filter((a) => a.id !== null).sort((a, b) => a.id! - b.id!);
    const recovered = events.filter((a) => a.id === null);
    if (recovered.length > 0) {
      const completionMatches = new Map<number, ReplayMatch>();
      for (const match of approved) {
        const tournamentId = tournamentForMatch.get(match.id);
        if (tournamentId === undefined) continue;
        const last = completionMatches.get(tournamentId);
        if (!last || match.scored_at > last.scored_at || (match.scored_at === last.scored_at && match.id > last.id)) {
          completionMatches.set(tournamentId, match);
        }
      }
      const order = (a: PointAward): [string, number] => {
        const match = a.match_id === null ? undefined : matches.get(a.match_id);
        const final = a.tournament_id === null ? undefined : completionMatches.get(a.tournament_id);
        return [match?.scored_at ?? a.created_at, match?.id ?? final?.id ?? 0];
      };
      const compare = (a: PointAward, b: PointAward) => {
        const [at, ai] = order(a);
        const [bt, bi] = order(b);
        return at.localeCompare(bt) || ai - bi ||
          Number(a.kind === "match_win") - Number(b.kind === "match_win");
      };
      recovered.sort(compare);
      events = [];
      let next = 0;
      for (const event of recorded) {
        while (next < recovered.length && compare(recovered[next], event) <= 0) events.push(recovered[next++]);
        events.push(event);
      }
      events.push(...recovered.slice(next));
      // Encode the recovered order in the ledger so ordinary replays and a
      // second repair reproduce it. Unchanged replays preserve award IDs.
      events = events.map((a) => ({ ...a, id: null }));
    } else {
      events = recorded;
    }

    const ratings = new Map<number, { elo: number; winnings: number; bestStreak: number; titles: number }>();
    const standings = new Map<string, { seasonId: number; playerId: number; winnings: number; wins: number; losses: number; currentStreak: number; bestStreak: number }>();
    const achievements = new Map<string, { playerId: number; key: string; unlockedAt: string }>();
    const rating = (playerId: number) => {
      let r = ratings.get(playerId);
      if (!r) { r = { elo: ELO_DEFAULT, winnings: 0, bestStreak: 0, titles: 0 }; ratings.set(playerId, r); }
      return r;
    };
    const standing = (seasonId: number, playerId: number) => {
      const key = `${seasonId}:${playerId}`;
      let s = standings.get(key);
      if (!s) {
        s = { seasonId, playerId, winnings: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0 };
        standings.set(key, s);
      }
      return s;
    };
    const unlock = (playerId: number, key: string, time: string) => {
      const identity = `${playerId}:${key}`;
      if (!achievements.has(identity)) achievements.set(identity, { playerId, key, unlockedAt: unlockTimes.get(identity) ?? time });
    };
    for (const event of events) {
      if (event.kind === "match_win" && event.match_id !== null) {
        const match = matches.get(event.match_id)!;
        const winnerId = match.winner_id!;
        const loserId = winnerId === match.player_one_id ? match.player_two_id : match.player_one_id;
        // Live scoring picks the lowest player ID when leaders have equal Elo.
        let topId: number | undefined;
        let topElo = -Infinity;
        for (const [id, r] of ratings) {
          if (r.elo > topElo || (r.elo === topElo && id < topId!)) { topId = id; topElo = r.elo; }
        }
        const winner = rating(winnerId);
        const loser = rating(loserId);
        const winnerElo = winner.elo;
        const loserElo = loser.elo;
        event.player_id = winnerId;
        event.points = matchWinPoints({ myElo: winnerElo, oppElo: loserElo, seasonMultiplier: SEASON_MULTIPLIER_DEFAULT });
        event.opponent_elo = loserElo;
        event.tournament_id = tournamentForMatch.get(match.id) ?? event.tournament_id;
        winner.elo = nextRating(winnerElo, loserElo, 1);
        loser.elo = nextRating(loserElo, winnerElo, 0);
        const ws = standing(event.season_id, winnerId);
        const ls = standing(event.season_id, loserId);
        ws.wins += 1;
        ws.currentStreak += 1;
        ws.bestStreak = Math.max(ws.bestStreak, ws.currentStreak);
        winner.bestStreak = Math.max(winner.bestStreak, ws.bestStreak);
        ls.losses += 1;
        ls.currentStreak = 0;
        if (topId === loserId && loserElo > winnerElo) unlock(winnerId, "giant_slayer", event.created_at);
      }
      const r = rating(event.player_id);
      r.winnings += event.points;
      standing(event.season_id, event.player_id).winnings += event.points;
      if (event.placement === "champion") r.titles += 1;
      for (const key of evaluateAchievements({ careerWinnings: r.winnings, bestStreak: r.bestStreak,
        tournamentTitles: r.titles, beatTopRanked: achievements.has(`${event.player_id}:giant_slayer`) })) {
        unlock(event.player_id, key, event.created_at);
      }
    }

    db.prepare("delete from player_ratings where guild_id=?").run(guildId);
    db.prepare("delete from season_standings where guild_id=?").run(guildId);
    db.prepare("delete from point_awards where guild_id=?").run(guildId);
    db.prepare("delete from player_achievements where guild_id=?").run(guildId);
    const insertAward = db.prepare(
      `insert into point_awards (id, guild_id, season_id, player_id, kind, placement, match_id, tournament_id, points, opponent_elo, size_multiplier, created_at)
       values (@id, @guild_id, @season_id, @player_id, @kind, @placement, @match_id, @tournament_id, @points, @opponent_elo, @size_multiplier, @created_at)`,
    );
    for (const event of events) insertAward.run(event);
    const insertRating = db.prepare("insert into player_ratings (guild_id, player_id, elo, career_winnings) values (?, ?, ?, ?)");
    for (const [id, r] of ratings) insertRating.run(guildId, id, r.elo, r.winnings);
    const insertStanding = db.prepare(
      `insert into season_standings (guild_id, season_id, player_id, winnings, wins, losses, current_streak, best_streak)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of standings.values()) insertStanding.run(guildId, s.seasonId, s.playerId, s.winnings, s.wins, s.losses, s.currentStreak, s.bestStreak);
    const insertAchievement = db.prepare("insert into player_achievements (guild_id, player_id, achievement_key, unlocked_at) values (?, ?, ?, ?)");
    for (const a of achievements.values()) insertAchievement.run(guildId, a.playerId, a.key, a.unlockedAt);
  });

  const rebuildStandings = (guildId: string, options: RebuildOptions = {}): void => rebuildStandingsTx(guildId, options);

  return { recordMatchResult, recordTournamentResult, getLeaderboard, getProfile, rebuildStandings };
}

export type ScoringService = ReturnType<typeof createScoringService>;
