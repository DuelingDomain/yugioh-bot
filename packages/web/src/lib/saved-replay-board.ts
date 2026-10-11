import type Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { toOrdinaryReplayView, type DuelEngineView, type DuelSession, type ReplayVisibility } from "@yugidraft/shared/duels";

/** Call only after the route rechecks current source access. The host still rejects oversized
 * move-by-move data; the viewer can render this single saved result using its existing contract.
 */
export async function savedReplayBoardResponse(response: NextResponse, input: {
  db: Database.Database; session: DuelSession; playerId: number; owner: boolean;
  version?: 1 | 2; visibility?: ReplayVisibility; seat?: number; reveal?: boolean;
}): Promise<NextResponse | null> {
  if (response.status !== 413) return null;
  const failure = await response.clone().json().catch(() => null);
  if (failure?.code !== "REPLAY_TOO_LARGE" || !["completed", "interrupted"].includes(input.session.status)) return null;
  const row = input.db.prepare<[number], {
    snapshot_public_json: string | null; snapshot_seat0_json: string | null;
    snapshot_seat1_json: string | null; snapshot_seats_json: string | null;
  }>("select snapshot_public_json, snapshot_seat0_json, snapshot_seat1_json, snapshot_seats_json from duels where id = ?").get(input.session.id);
  if (!row) return null;
  const ownSeat = input.session.seats.find(seat => seat.playerId === input.playerId)?.seat ?? null;
  const visibility = input.visibility ?? "mine";
  const dataSeat = input.owner && input.seat !== undefined ? input.seat : visibility === "public" ? null : ownSeat;
  try {
    const seats = row.snapshot_seats_json && (dataSeat !== null || (input.owner && input.reveal))
      ? JSON.parse(row.snapshot_seats_json) as Array<DuelEngineView | null> : [];
    const savedSeat = (seat: number) => seats[seat] ?? (seat < 2
      ? JSON.parse((seat === 0 ? row.snapshot_seat0_json : row.snapshot_seat1_json) ?? "null") as DuelEngineView | null : null);
    let board = dataSeat === null ? JSON.parse(row.snapshot_public_json ?? "null") as DuelEngineView | null : savedSeat(dataSeat);
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
      replayError: { code: "REPLAY_TOO_LARGE", error: message },
    } : { ...common, frames: [frame], replayError: { code: "REPLAY_TOO_LARGE", error: message } },
    { headers: { "cache-control": "private, no-store" } });
  } catch { return null; }
}
