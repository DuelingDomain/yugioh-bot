import type { LeaderboardRow } from "@/components/leaderboard/leaderboard-model";

export const activeSeason = { number: 3, name: null, startedAt: "2026-08-04 18:02:11" };
export const seasonStartedOn = "Tue, Aug 4";

// Board 05, in the API's winnings order. Elo is independent of place.
export const referenceRows: LeaderboardRow[] = [
  [1, "Kestrel", 1468, "Platinum", 312, 24, 7, 77, 6],
  [2, "voidpriest", 1612, "Diamond", 287, 21, 6, 78, 2],
  [3, "BlueEyesBen", 1291, "Gold", 241, 19, 11, 63, 0],
  [4, "Toon Tina", 1236, "Gold", 198, 16, 10, 62, 3],
  [5, "Imran", 1184, "Gold", 176, 15, 9, 63, 1],
  [6, "Marik_Mains", 1062, "Silver", 143, 12, 12, 50, 0],
  [7, "duelist.josh", 1120, "Gold", 128, 11, 9, 55, 0],
  [8, "Rhett", 1004, "Silver", 97, 9, 12, 43, 0],
  [9, "sealed.sam", 958, "Silver", 71, 7, 10, 41, 1],
  [10, "NumeronNat", 871, "Bronze", 44, 4, 11, 27, 0],
  [11, "crowler", 842, "Bronze", 22, 2, 8, 20, 0],
].map(([playerId, displayName, rating, rank, winnings, wins, losses, winRate, currentStreak]) => ({
  playerId: Number(playerId), displayName: String(displayName), rating: Number(rating),
  rank: String(rank), winnings: Number(winnings), wins: Number(wins), losses: Number(losses),
  winRate: Number(winRate), currentStreak: Number(currentStreak),
}));

export const allTimeRows = referenceRows.map((row) => ({
  ...row, wins: 0, losses: 0, winRate: 0, currentStreak: 0,
}));
