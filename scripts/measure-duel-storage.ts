import { gzipSync } from "node:zlib";
import { storedBoardFixture } from "../packages/shared/tests/helpers/stored-board.js";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
for (const format of ["1v1", "ffa3", "ffa4", "tag"] as const) {
  const publicBoard = storedBoardFixture(format);
  const seats = Array.from({ length: publicBoard.seats.length }, (_, seat) => storedBoardFixture(format, seat));
  const legacy = [publicBoard, seats[0], seats[1], ...(seats.length > 2 ? [seats] : [])];
  const deduped = seats.length > 2 ? [publicBoard, seats] : legacy;
  const before = legacy.reduce((sum, value) => sum + bytes(value), 0);
  const plain = deduped.reduce((sum, value) => sum + bytes(value), 0);
  const gzip = deduped.reduce((sum, value) => sum + gzipSync(JSON.stringify(value)).byteLength, 0);
  console.log(JSON.stringify({ format, boardBytes: bytes(publicBoard), eventsPercent: +(100 * bytes(publicBoard.events) / bytes(publicBoard)).toFixed(2),
    logPercent: +(100 * bytes(publicBoard.log) / bytes(publicBoard)).toFixed(2), before, deduped: plain, gzip,
    gzipPercentOfDeduped: +(100 * gzip / plain).toFixed(2), totalSavingsPercent: +(100 * (1 - gzip / before)).toFixed(2) }));
}
