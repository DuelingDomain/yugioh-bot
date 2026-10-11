import { gzipSync, gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { storedBoardFixture } from "../helpers/stored-board.js";
import { compressStoredSnapshot, decodeStoredSnapshot, encodeStoredSnapshot, readStoredBoard, readStoredSeatBoards,
  storedBoardStamp, storedTurnCount } from "../../src/services/stored-duel-snapshots.js";

it("reads old JSON and round trips gzip without changing events, logs, or bytes", async () => {
  const board = storedBoardFixture();
  const plain = encodeStoredSnapshot(board);
  expect(decodeStoredSnapshot(plain)).toEqual(board);
  const compressed = await compressStoredSnapshot(plain);
  expect(Buffer.isBuffer(compressed)).toBe(true);
  expect(gunzipSync(compressed as Buffer).toString()).toBe(plain);
  expect(decodeStoredSnapshot(compressed)).toEqual(board);
  expect(await compressStoredSnapshot(compressed)).toBe(compressed);
});
it.each([null, "broken", gzipSync("broken"), Buffer.from([1, 2, 3]), "42", '{"seats":[null]}'])("rejects unreadable boards (%s)", raw => {
  expect(readStoredBoard({ snapshot_public_json: raw }, null)).toBeNull();
});
it.each([false, true])("prefers the seat list and preserves projection privacy (gzip=%s)", compressed => {
  const encode = (v: unknown) => compressed ? gzipSync(JSON.stringify(v)) : encodeStoredSnapshot(v);
  const seats = [0, 1, 2, 3].map(seat => storedBoardFixture("ffa4", seat));
  const row = { snapshot_public_json: encode(storedBoardFixture()), snapshot_seats_json: encode(seats),
    snapshot_seat0_json: encode(storedBoardFixture("ffa4", 3)), snapshot_seat1_json: null };
  expect(readStoredBoard(row, 0)).toEqual(seats[0]);
  expect(readStoredBoard(row, 3)).toEqual(seats[3]);
  expect(readStoredBoard(row, null)?.seats.every(seat => seat.hand.every(card => card.code === undefined))).toBe(true);
  expect(readStoredSeatBoards(row.snapshot_seats_json)).toEqual(seats);
});
it("invalidates stamps on compression, deduplication, and stored final-board changes", () => {
  const raw = JSON.stringify(storedBoardFixture());
  const row = { snapshot_public_json: raw, snapshot_seat0_json: raw, snapshot_seat1_json: null, snapshot_seats_json: null };
  expect(storedBoardStamp(row, null)).toBe(storedBoardStamp({ ...row }, null));
  expect(storedBoardStamp({ ...row, snapshot_public_json: gzipSync(raw) }, null)).not.toBe(storedBoardStamp(row, null));
  expect(storedBoardStamp({ ...row, snapshot_seat0_json: null }, 0)).not.toBe(storedBoardStamp(row, 0));
  expect(storedBoardStamp({ ...row, snapshot_seat1_json: raw }, null, true)).not.toBe(storedBoardStamp(row, null, true));
});
it("extracts only safe numeric turns from old, gzip, seat-list, and clock values", () => {
  for (const turn of [true, "7", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(storedTurnCount({ snapshot_public_json: JSON.stringify({ turn }) })).toBeNull();
  }
  expect(storedTurnCount({ snapshot_public_json: gzipSync('{"turn":7}') })).toBe(7);
  expect(storedTurnCount({ snapshot_seats_json: gzipSync('[null,null,{"seats":[],"turn":9}]') })).toBe(9);
  expect(storedTurnCount({ clock_json: '{"turn":8}' })).toBe(8);
});

it("decodes UTF-8 JSON BLOBs as well as gzip and rejects truncated gzip", () => {
  const raw = JSON.stringify(storedBoardFixture());
  expect(readStoredBoard({ snapshot_public_json: Buffer.from(raw) }, null)).toEqual(storedBoardFixture());
  expect(decodeStoredSnapshot(Buffer.from([0x1f, 0x8b]))).toBeNull();
});
it("returns no other projection for seat 2+ without a seat list", () => {
  const raw = JSON.stringify(storedBoardFixture());
  for (const seat of [2, 3, 8]) expect(readStoredBoard({ snapshot_public_json: raw, snapshot_seat0_json: raw, snapshot_seat1_json: raw }, seat)).toBeNull();
});
it("invalidates higher-seat and reveal stamps after seat-list changes and dedup", () => {
  const raw = JSON.stringify(storedBoardFixture());
  const row = { snapshot_seat0_json: raw, snapshot_seat1_json: raw, snapshot_seats_json: JSON.stringify([raw, raw, raw]) };
  expect(storedBoardStamp({ ...row, snapshot_seats_json: gzipSync(row.snapshot_seats_json) }, 2)).not.toBe(storedBoardStamp(row, 2));
  expect(storedBoardStamp({ ...row, snapshot_seat0_json: null, snapshot_seat1_json: null }, null, true)).not.toBe(storedBoardStamp(row, null, true));
});
