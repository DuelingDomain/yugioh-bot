import { readStoredBoard, STORED_BOARD_COLUMNS, type StoredDuelBoards } from "@yugidraft/shared/services";
import type Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { toOrdinaryReplayView, type DuelSession, type ReplayVisibility } from "@yugidraft/shared/duels";

/** Call only after the route rechecks current source access. The host still rejects oversized
 * move-by-move data; the viewer can render this single saved result using its existing contract.
 */
export async function savedReplayBoardResponse(response: NextResponse, input: {
  db: Database.Database; session: DuelSession; playerId: number; owner: boolean;
  version?: 1 | 2; visibility?: ReplayVisibility; seat?: number; reveal?: boolean;
}): Promise<NextResponse | null> {
  if (response.status !== 413 && response.status !== 409) return null;
  const failure = await response.clone().json().catch(() => null);
  const recoverable = (response.status === 413 && failure?.code === "REPLAY_TOO_LARGE")
    || (response.status === 409 && failure?.code === "ENGINE_UNAVAILABLE_FOR_SOURCE");
  if (!recoverable || !["completed", "interrupted"].includes(input.session.status)) return null;
  const row = input.db.prepare<[number], StoredDuelBoards>(`select ${STORED_BOARD_COLUMNS} from duels where id = ?`).get(input.session.id);
  if (!row) return null;
  const ownSeat = input.session.seats.find(seat => seat.playerId === input.playerId)?.seat ?? null;
  const visibility = input.visibility ?? "mine";
  const dataSeat = input.owner && input.seat !== undefined ? input.seat : visibility === "public" ? null : ownSeat;
  try {
    const savedSeat = (seat: number) => readStoredBoard(row, seat);
    let board = readStoredBoard(row, dataSeat);
    if (!board) return null;
    if (input.owner && input.reveal) board = { ...board, seats: board.seats.map(seat => {
      const own = savedSeat(seat.seat)?.seats.find(candidate => candidate.seat === seat.seat);
      return own ? { ...seat, hand: own.hand, extra: own.extra } : seat;
    }) };
    const message = typeof failure.error === "string" ? failure.error : "Move-by-move replay exceeds the size limit.";
    const view = toOrdinaryReplayView({ ...board, log: [...board.log, {
      id: board.log.reduce((id, entry) => Math.max(id, entry.id), 0) + 1,
      text: `${message} Showing the saved final board.`,
    }] });
    const frame = { step: 0, actorSeat: null, view };
    const common = { session: input.session, role: ownSeat === null ? "spectator" : "player", mySeat: ownSeat };
    return NextResponse.json(input.version === 2 || input.owner ? {
      ...common, version: 2, sourceVersion: `saved-board-${input.session.id}`, visibility, dataSeat,
      ...(input.owner ? { reveal: input.reveal ?? false, capabilities: { canFork: false, privateSeats: [] } } : {}),
      frames: [{ ...frame, frameId: "saved-final-board", kind: "result", cursor: null }],
      replayError: { code: failure.code, error: message },
    } : { ...common, frames: [frame], replayError: { code: failure.code, error: message } },
    { headers: { "cache-control": "private, no-store" } });
  } catch { return null; }
}
