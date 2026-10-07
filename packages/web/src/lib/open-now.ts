/** Response of GET /api/lobby/open: what a guild member can join or watch right now. */
export type OpenNow = {
  /** Tournaments still taking players, newest first, at most 5. */
  tournaments: Array<{ slug: string; name: string; format: string; joinedCount: number; viewerJoined: boolean }>;
  /** Draft lobbies a guild member can join from a link, newest first, at most 5. */
  drafts: Array<{ slug: string; name: string; mode: string; seatsTaken: number; seatCount: number | null; viewerJoined: boolean }>;
  /** Duels being played in the guild now. */
  duelsInProgress: number;
};

export const EMPTY_OPEN_NOW: OpenNow = { tournaments: [], drafts: [], duelsInProgress: 0 };
