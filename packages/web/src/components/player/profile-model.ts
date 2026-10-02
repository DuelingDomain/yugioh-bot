import { ACHIEVEMENTS, ELO_K, expectedScore } from "@yugidraft/shared/scoring";
import type { ScoringService } from "@yugidraft/shared/services";

export type Profile = ReturnType<ScoringService["getProfile"]>;
export type ProfileScope = "season" | "all";

export interface AwardEntry {
  kind: string;
  points: number;
  created_at: string;
  tournament_id: number | null;
  tournament_name: string | null;
}

// SQLite current_timestamp has no zone suffix. Read it as UTC and format in UTC,
// so the server render and the browser never disagree about the calendar day.
export function parseStamp(stamp: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp.replace(" ", "T")}Z`);
}

export function formatDay(stamp: string): string {
  const date = parseStamp(stamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------- winnings earned ----------

export interface AwardGroup {
  key: string;
  title: string;
  entries: AwardEntry[];
}

/** Consecutive awards from the same tournament share a header; awards with none are ranked matches. */
export function groupAwards(recent: AwardEntry[]): AwardGroup[] {
  const groups: AwardGroup[] = [];
  for (const entry of recent) {
    const key = entry.tournament_id === null ? "ranked" : `t${entry.tournament_id}`;
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({
        key,
        title: entry.tournament_id === null ? "Ranked matches" : (entry.tournament_name ?? "Tournament"),
        entries: [entry],
      });
    }
  }
  return groups;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Winnings earned in the last 7 days, from the awards the payload carries.
 * The payload holds only the last 10, so when all 10 fall inside the week the
 * true sum is unknown and this returns null rather than a number that is too low.
 */
export function winningsThisWeek(recent: AwardEntry[], now: number = Date.now()): number | null {
  const inWeek = recent.filter((entry) => now - parseStamp(entry.created_at).getTime() < WEEK_MS);
  if (inWeek.length === 0) return null;
  if (recent.length >= 10 && inWeek.length === recent.length) return null;
  return inWeek.reduce((sum, entry) => sum + entry.points, 0);
}

// ---------- how Elo moves ----------

export function getEloGuide() {
  const swing = (gap: number) => {
    const expected = expectedScore(1000, 1000 + gap);
    return { win: Math.round(ELO_K * (1 - expected)), loss: Math.round(ELO_K * (0 - expected)) };
  };
  return [
    { label: "200 below you", ...swing(-200) },
    { label: "Level with you", ...swing(0) },
    { label: "200 above you", ...swing(200) },
    { label: "400 above you", ...swing(400) },
  ];
}

// ---------- achievements ----------

export type AchievementState = "new" | "on" | "off";

export interface AchievementView {
  key: string;
  name: string;
  icon: string;
  criteria: string;
  state: AchievementState;
  unlockedAt: string | null;
  /** Career winnings progress, only where it can be counted and the viewer is the owner. */
  progress: { value: number; goal: number; toGo: number; close: boolean } | null;
  /** A locked tile on your own profile with no countable progress: it reads "Not yet". */
  isOwnerLocked: boolean;
}

// Criteria text was checked against the scoring code (board 12).
const CRITERIA: Record<string, string> = {
  first_tournament_win: "Finish first in a tournament that runs to the end.",
  streak_10: "Win 10 matches in a row inside one season.",
  giant_slayer: "Beat the server's highest-rated player while rated below them.",
  winnings_1000: "Earn 1,000 winnings across all seasons.",
  winnings_5000: "Earn 5,000 winnings across all seasons.",
  champion_x3: "Finish first in three tournaments.",
};

const WINNINGS_GOALS: Record<string, number> = { winnings_1000: 1000, winnings_5000: 5000 };

// Locked tiles keep a fixed order so a pair of steps always sits together.
const LOCKED_ORDER = ["streak_10", "winnings_1000", "winnings_5000", "champion_x3", "giant_slayer"];

export function buildAchievements(opts: {
  unlocked: Array<{ achievement_key: string; unlocked_at: string }>;
  careerWinnings: number;
  fresh: string[];
  isOwner: boolean;
}): AchievementView[] {
  const dates = new Map(opts.unlocked.map((a) => [a.achievement_key, a.unlocked_at]));
  const fresh = new Set(opts.isOwner ? opts.fresh : []);

  const views = ACHIEVEMENTS.map((achievement): AchievementView => {
    const unlockedAt = dates.get(achievement.key) ?? null;
    const goal = WINNINGS_GOALS[achievement.key];
    let progress: AchievementView["progress"] = null;
    if (unlockedAt === null && goal !== undefined && opts.isOwner) {
      const value = Math.min(opts.careerWinnings, goal);
      const toGo = goal - value;
      progress = { value, goal, toGo, close: value / goal >= 0.9 };
    }
    return {
      key: achievement.key,
      name: achievement.name,
      icon: achievement.icon,
      criteria: CRITERIA[achievement.key] ?? "",
      state: unlockedAt === null ? "off" : fresh.has(achievement.key) ? "new" : "on",
      unlockedAt,
      progress,
      isOwnerLocked: unlockedAt === null && opts.isOwner && progress === null,
    };
  });

  const stamp = (v: AchievementView) => (v.unlockedAt ? parseStamp(v.unlockedAt).getTime() : 0);
  const fresher = views.filter((v) => v.state === "new").sort((a, b) => stamp(b) - stamp(a));
  const earned = views.filter((v) => v.state === "on").sort((a, b) => stamp(b) - stamp(a));
  const locked = views
    .filter((v) => v.state === "off")
    .sort((a, b) => LOCKED_ORDER.indexOf(a.key) - LOCKED_ORDER.indexOf(b.key));
  return [...fresher, ...earned, ...locked];
}

export const seenKey = (playerId: number) => `achievements:seen:${playerId}`;
export const rankSeenKey = (playerId: number) => `rank:lastSeen:${playerId}`;

/**
 * Works out which unlocks are new on this device. The first visit on a device
 * returns none (it only records the list), so old unlocks never all light up at once.
 */
export function freshUnlocks(stored: string | null, unlockedKeys: string[]): string[] {
  if (stored === null) return [];
  let seen: unknown;
  try {
    seen = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(seen)) return [];
  const known = new Set(seen.filter((k): k is string => typeof k === "string"));
  return unlockedKeys.filter((key) => !known.has(key));
}
