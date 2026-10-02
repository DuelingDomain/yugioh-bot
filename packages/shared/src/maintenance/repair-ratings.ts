import Database from "better-sqlite3";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createScoringService } from "../services/scoring.js";

type PlayerIdentity = { guildId: string; playerId: number; displayName: string };
type PlayerFigures = { elo: number; winnings: number; wins: number; losses: number };
type SeasonFigures = { winnings: number; wins: number; losses: number; currentStreak: number; bestStreak: number };
type SeasonIdentity = PlayerIdentity & { seasonId: number; seasonNumber: number };
type AwardFigures = {
  kind: string;
  placement: string | null;
  matchId: number | null;
  tournamentId: number | null;
  points: number;
  opponentElo: number | null;
  sizeMultiplier: number | null;
  createdAt: string;
};
type AwardRow = PlayerIdentity & { seasonId: number } & AwardFigures;
type AchievementRow = PlayerIdentity & { achievementKey: string; unlockedAt: string };

export type RepairChange =
  | (PlayerIdentity & { kind: "player"; current: PlayerFigures; rebuilt: PlayerFigures })
  | (SeasonIdentity & { kind: "season"; current: SeasonFigures | null; rebuilt: SeasonFigures | null })
  | (PlayerIdentity & { kind: "award_added" | "award_removed"; seasonId: number; award: AwardFigures })
  | (AchievementRow & { kind: "achievement_added" | "achievement_removed" });

export type RepairReport = {
  applied: boolean;
  summary: {
    playersChanged: number;
    seasonsChanged: number;
    awardsAdded: number;
    awardsRemoved: number;
    achievementsAdded: number;
    achievementsRemoved: number;
  };
  changes: RepairChange[];
};

function snapshot(db: Database.Database) {
  const players = db.prepare(
    `select p.guild_id as guildId, p.id as playerId, p.display_name as displayName,
            coalesce(pr.elo, 1000) as elo, coalesce(pr.career_winnings, 0) as winnings,
            coalesce(sum(ss.wins), 0) as wins, coalesce(sum(ss.losses), 0) as losses
     from players p
     left join player_ratings pr on pr.guild_id=p.guild_id and pr.player_id=p.id
     left join season_standings ss on ss.guild_id=p.guild_id and ss.player_id=p.id
     group by p.id order by p.guild_id, p.id`,
  ).all() as Array<PlayerIdentity & PlayerFigures>;
  const seasons = db.prepare(
    `select ss.guild_id as guildId, ss.player_id as playerId, p.display_name as displayName,
            ss.season_id as seasonId, s.number as seasonNumber, ss.winnings, ss.wins, ss.losses,
            ss.current_streak as currentStreak, ss.best_streak as bestStreak
     from season_standings ss join players p on p.id=ss.player_id join seasons s on s.id=ss.season_id
     order by ss.guild_id, ss.season_id, ss.player_id`,
  ).all() as Array<SeasonIdentity & SeasonFigures>;
  const awards = db.prepare(
    `select pa.guild_id as guildId, pa.player_id as playerId, p.display_name as displayName,
            pa.season_id as seasonId, pa.kind, pa.placement, pa.match_id as matchId,
            pa.tournament_id as tournamentId, pa.points, pa.opponent_elo as opponentElo,
            pa.size_multiplier as sizeMultiplier, pa.created_at as createdAt
     from point_awards pa join players p on p.id=pa.player_id order by pa.guild_id, pa.id`,
  ).all() as AwardRow[];
  const achievements = db.prepare(
    `select a.guild_id as guildId, a.player_id as playerId, p.display_name as displayName,
            a.achievement_key as achievementKey, a.unlocked_at as unlockedAt
     from player_achievements a join players p on p.id=a.player_id
     order by a.guild_id, a.player_id, a.achievement_key`,
  ).all() as AchievementRow[];
  return { players, seasons, awards, achievements };
}

function differences(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>): RepairChange[] {
  const changes: RepairChange[] = [];
  const identity = ({ guildId, playerId, displayName }: PlayerIdentity) => ({ guildId, playerId, displayName });
  const playerFigures = ({ elo, wins, losses, winnings }: PlayerFigures) => ({ elo, wins, losses, winnings });
  const seasonFigures = (row: SeasonFigures | undefined) => row
    ? { winnings: row.winnings, wins: row.wins, losses: row.losses, currentStreak: row.currentStreak, bestStreak: row.bestStreak }
    : null;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const playersAfter = new Map(after.players.map((p) => [p.playerId, p]));
  for (const player of before.players) {
    const current = playerFigures(player);
    const rebuilt = playerFigures(playersAfter.get(player.playerId)!);
    if (!equal(current, rebuilt)) changes.push({ kind: "player", ...identity(player), current, rebuilt });
  }
  const seasonKey = (s: SeasonIdentity) => `${s.guildId}:${s.seasonId}:${s.playerId}`;
  const seasonsBefore = new Map(before.seasons.map((s) => [seasonKey(s), s]));
  const seasonsAfter = new Map(after.seasons.map((s) => [seasonKey(s), s]));
  for (const key of new Set([...seasonsBefore.keys(), ...seasonsAfter.keys()])) {
    const previous = seasonsBefore.get(key);
    const next = seasonsAfter.get(key);
    const current = seasonFigures(previous);
    const rebuilt = seasonFigures(next);
    const row = next ?? previous!;
    if (!equal(current, rebuilt)) changes.push({ kind: "season", ...identity(row),
      seasonId: row.seasonId, seasonNumber: row.seasonNumber, current, rebuilt });
  }
  const awardKey = (a: AwardRow) => `${a.guildId}:${a.kind}:${a.matchId ?? `${a.tournamentId}:${a.playerId}`}`;
  const awardsBefore = new Map(before.awards.map((a) => [awardKey(a), a]));
  const awardsAfter = new Map(after.awards.map((a) => [awardKey(a), a]));
  const awardChange = (kind: "award_added" | "award_removed", a: AwardRow): RepairChange => ({
    kind, ...identity(a), seasonId: a.seasonId,
    award: { kind: a.kind, placement: a.placement, matchId: a.matchId, tournamentId: a.tournamentId,
      points: a.points, opponentElo: a.opponentElo, sizeMultiplier: a.sizeMultiplier, createdAt: a.createdAt },
  });
  // An altered award appears as a removal and an addition. IDs are bookkeeping;
  // recovery may resequence them to persist the repaired historical order.
  for (const award of before.awards) {
    if (!equal(award, awardsAfter.get(awardKey(award)))) changes.push(awardChange("award_removed", award));
  }
  for (const award of after.awards) {
    if (!equal(award, awardsBefore.get(awardKey(award)))) changes.push(awardChange("award_added", award));
  }
  const achievementKey = (a: AchievementRow) => `${a.guildId}:${a.playerId}:${a.achievementKey}`;
  const achievementsBefore = new Map(before.achievements.map((a) => [achievementKey(a), a]));
  const achievementsAfter = new Map(after.achievements.map((a) => [achievementKey(a), a]));
  for (const a of before.achievements) {
    if (!equal(a, achievementsAfter.get(achievementKey(a)))) changes.push({ kind: "achievement_removed", ...a });
  }
  for (const a of after.achievements) {
    if (!equal(a, achievementsBefore.get(achievementKey(a)))) changes.push({ kind: "achievement_added", ...a });
  }
  return changes;
}

/** Repair current-schema scoring. Dry runs leave the supplied database untouched. */
export function repairRatings(source: Database.Database, options: { apply?: boolean } = {}): RepairReport {
  const working = options.apply ? source : new Database(source.serialize());
  try {
    working.pragma("foreign_keys = ON");
    working.pragma("busy_timeout = 5000");
    return working.transaction(() => {
      const before = snapshot(working);
      const guilds = working.prepare(
        `select guild_id from matches union select guild_id from player_ratings
         union select guild_id from point_awards union select guild_id from season_standings
         union select guild_id from player_achievements union select guild_id from tournaments order by guild_id`,
      ).all() as Array<{ guild_id: string }>;
      const scoring = createScoringService(working);
      for (const { guild_id: guildId } of guilds) scoring.rebuildStandings(guildId, { recoverMissing: true });
      const changes = differences(before, snapshot(working));
      const count = (kind: RepairChange["kind"]) => changes.filter((c) => c.kind === kind).length;
      return { applied: options.apply ?? false, changes, summary: {
        playersChanged: count("player"), seasonsChanged: count("season"), awardsAdded: count("award_added"),
        awardsRemoved: count("award_removed"), achievementsAdded: count("achievement_added"), achievementsRemoved: count("achievement_removed"),
      } };
    }).immediate();
  } finally {
    if (working !== source) working.close();
  }
}

export function formatRepairReport(report: RepairReport): string {
  const s = report.summary;
  const summary = `${report.applied ? "APPLIED" : "DRY RUN"}: ${s.playersChanged} players, ${s.seasonsChanged} season standings; ` +
    `awards +${s.awardsAdded}/-${s.awardsRemoved}; achievements +${s.achievementsAdded}/-${s.achievementsRemoved}. ` +
    (report.applied ? "Repair written." : "No database changes written.");
  return [summary, ...report.changes.map((change) => JSON.stringify(change))].join("\n");
}

export function runRepairRatingsCli(args: string[], write: (text: string) => void = console.log): void {
  const usage = "node packages/shared/dist/maintenance/repair-ratings.js --db <path> [--apply]";
  const { values } = parseArgs({ args, options: {
    db: { type: "string" }, apply: { type: "boolean", default: false }, help: { type: "boolean", default: false },
  } });
  if (values.help) { write(usage); return; }
  if (!values.db) throw new Error(`An explicit --db <path> is required. Usage: ${usage}`);
  // Never migrate or use openDatabase: both can write during a dry run.
  const source = new Database(values.db, { readonly: !values.apply, fileMustExist: true });
  try { write(formatRepairReport(repairRatings(source, { apply: values.apply }))); }
  finally { source.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runRepairRatingsCli(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
