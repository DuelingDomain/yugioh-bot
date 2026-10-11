import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzipSync } from "node:zlib";
import type { DuelEngineView } from "../duels/index.js";

/** SQLite TEXT-affinity snapshot columns also accept gzip BLOBs. */
export type StoredSnapshot = string | Buffer | null;
export interface StoredDuelBoards {
  snapshot_public_json?: StoredSnapshot;
  snapshot_seat0_json?: StoredSnapshot;
  snapshot_seat1_json?: StoredSnapshot;
  snapshot_seats_json?: StoredSnapshot;
}
export const STORED_BOARD_COLUMNS = "snapshot_public_json, snapshot_seat0_json, snapshot_seat1_json, snapshot_seats_json";
const gzipAsync = promisify(gzip);

export function encodeStoredSnapshot(value: unknown): string {
  return JSON.stringify(value);
}

export function decodeStoredSnapshot(raw: StoredSnapshot | undefined): unknown {
  if (!raw) return null;
  try {
    const text = typeof raw === "string" ? raw : (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString("utf8");
    return JSON.parse(text);
  }
  catch { return null; }
}

/** Do CPU work before taking the write lock. Preserve malformed values and original JSON bytes. */
export async function compressStoredSnapshot(raw: StoredSnapshot): Promise<StoredSnapshot> {
  if (typeof raw !== "string" || decodeStoredSnapshot(raw) === null) return raw;
  const compressed = await gzipAsync(raw);
  return compressed.length < Buffer.byteLength(raw) ? compressed : raw;
}

function board(value: unknown): DuelEngineView | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as DuelEngineView).seats)) return null;
  if (!(value as DuelEngineView).seats.every(seat => seat !== null && typeof seat === "object" && Number.isSafeInteger(seat.seat))) return null;
  return { ...value as DuelEngineView, prompt: null, prioritySeat: null };
}

export function readStoredSeatBoards(raw: StoredSnapshot | undefined): Array<DuelEngineView | null> {
  const parsed = decodeStoredSnapshot(raw);
  return Array.isArray(parsed) ? parsed.map(board) : [];
}

/** Cache decoded projections within one request, including the shared seat list. */
export function createStoredBoardReader(row: StoredDuelBoards | undefined): (seat: number | null) => DuelEngineView | null {
  let seats: Array<DuelEngineView | null> | undefined;
  const views = new Map<number | null, DuelEngineView | null>();
  return seat => {
    if (!row || (seat !== null && (!Number.isInteger(seat) || seat < 0))) return null;
    if (views.has(seat)) return views.get(seat)!;
    let view: DuelEngineView | null;
    if (seat === null) view = board(decodeStoredSnapshot(row.snapshot_public_json));
    else {
      seats ??= readStoredSeatBoards(row.snapshot_seats_json);
      view = seats[seat] ?? board(decodeStoredSnapshot(seat === 0 ? row.snapshot_seat0_json : seat === 1 ? row.snapshot_seat1_json : null));
    }
    views.set(seat, view);
    return view;
  };
}

/** The complete seat list supersedes legacy columns. Never return another seat's view. */
export function readStoredBoard(row: StoredDuelBoards | undefined, seat: number | null): DuelEngineView | null {
  return createStoredBoardReader(row)(seat);
}

export function freezeStoredBoard(view: DuelEngineView, result: NonNullable<DuelEngineView["result"]>): string {
  return encodeStoredSnapshot({ ...view, prompt: null, prioritySeat: null, result });
}

/** Storage changes intentionally invalidate replay caches, without parsing large boards for a key. */
export function storedBoardStamp(row: StoredDuelBoards | undefined, seat: number | null, reveal = false): string {
  const selected = !row ? [] : reveal ? [row.snapshot_public_json, row.snapshot_seat0_json, row.snapshot_seat1_json, row.snapshot_seats_json]
    : seat === null ? [row.snapshot_public_json]
      : [row.snapshot_seats_json, seat === 0 ? row.snapshot_seat0_json : seat === 1 ? row.snapshot_seat1_json : null];
  const hash = createHash("sha256");
  for (const raw of selected) {
    hash.update(raw === null || raw === undefined ? "null" : typeof raw === "string" ? "json" : "gzip").update("\0");
    hash.update(raw ?? "null").update("\0");
  }
  return hash.digest("hex");
}

export function storedTurnCount(row: StoredDuelBoards & { clock_json?: StoredSnapshot }): number | null {
  const single = [row.snapshot_public_json, row.snapshot_seat0_json, row.snapshot_seat1_json, row.clock_json];
  for (const raw of single) {
    const turn = (decodeStoredSnapshot(raw) as { turn?: unknown } | null)?.turn;
    if (typeof turn === "number" && Number.isSafeInteger(turn) && turn >= 0) return turn;
  }
  for (const view of readStoredSeatBoards(row.snapshot_seats_json)) {
    if (view && Number.isSafeInteger(view.turn) && view.turn >= 0) return view.turn;
  }
  return null;
}
