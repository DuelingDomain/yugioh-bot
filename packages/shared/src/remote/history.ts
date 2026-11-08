import type { PatchOp } from "./delta.js";
import type { RemoteEvent, RemoteState, RemoteTable, SeatCount } from "./types.js";

/** One ended Remote table in Match history. `remote: true` tells it apart from an online DuelListItem. */
export type RemoteHistoryItem = {
  remote: true;
  slug: string;
  /** The cursor that continues the list after this row. */
  cursor: string;
  name: string;
  seatCount: SeatCount;
  /** Same words as the online format filter: 2 seats = 1v1. */
  tableType: "1v1" | "ffa3" | "ffa4";
  /** The card-rule format id, for example "normal". */
  formatId: string;
  bestOf: 1 | 3;
  visibility: "public" | "private";
  /** Set for a tournament table. `slug` is null when the tournament has no web page. */
  tournament: { slug: string | null; name: string | null } | null;
  status: "ended";
  createdAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  turnCount: number | null;
  endReason: string | null;
  /** The viewer's seat, or null when the viewer did not play. */
  mySeat: number | null;
  winnerSeat: number | null;
  /** Games won per seat in the match. */
  wins: number[];
  seats: { seat: number; displayName: string; bot: boolean; result: "win" | "loss" | "draw" | null }[];
};

export type RemoteHistoryOptions = {
  scope?: "mine" | "all";
  /** Only tables with a match or legacy game winner, filtered before pagination. */
  completed?: boolean;
  from?: string;
  to?: string;
  /** "1v1", "tag", "ffa3" or "ffa4". Remote has no Tag, so "tag" lists nothing. */
  format?: string;
  q?: string;
  cursor?: string | null;
  limit?: number;
};
export type RemoteHistoryPage = { items: RemoteHistoryItem[]; nextCursor: string | null; canSeeAll: boolean };

/** One event of the log with the board change it caused. Apply `ops` to the board before it to get the board after it. */
export type RemoteReplayStep = { seq: number; at: number; turn: number; event: RemoteEvent; ops: PatchOp[] };
/**
 * A finished Remote table as a list of steps. `initial` is the board before the first event.
 * A player gets that player's own projection; an admin or a spectator gets the spectator projection.
 */
export type RemoteReplay = {
  table: RemoteTable;
  viewer: "player" | "spectator";
  mySeat: number | null;
  initial: RemoteState;
  steps: RemoteReplayStep[];
};
