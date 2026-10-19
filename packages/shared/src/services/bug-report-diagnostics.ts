const MAX_LOG_LINES = 400;
const MAX_PART_BYTES = 128 * 1024;
const BOARD_OMITTED = "the board exceeded the storage limit";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Keep the newest entries within both limits, including a useful tail of an oversized final entry. */
function logTail(entries: unknown[]): unknown[] {
  const tail: unknown[] = [];
  let size = 2;
  for (const entry of entries.slice(-MAX_LOG_LINES).reverse()) {
    let kept = entry;
    if (bytes(kept) > 8192) {
      const text = typeof entry === "string" ? entry : object(entry) && typeof entry.text === "string" ? entry.text : "Log entry exceeded the storage limit";
      kept = { text: text.slice(-2000), truncated: true };
    }
    const length = bytes(kept) + 1;
    if (size + length > MAX_PART_BYTES) break;
    tail.push(kept);
    size += length;
  }
  return tail.reverse();
}

/** Apply limits at the storage boundary. Keep the JSON readable by the owner data route. */
export function serializeBugReportDiagnostics(input: unknown): string | null {
  if (!object(input)) return null;
  const originalLog = Array.isArray(input.log) ? input.log : [];
  // This log is trusted server data. Preserve every public event for diagnosis.
  const log = originalLog;
  const originalBoardLog = object(input.board) && Array.isArray(input.board.log) ? input.board.log : [];
  const boardLog = logTail(originalBoardLog);
  const board = object(input.board) ? { ...input.board, log: boardLog } : null;
  const diagnostics = {
    board: board && bytes(board) <= MAX_PART_BYTES ? board : null,
    log,
    ...(object(input.moment) ? { moment: input.moment } : {}),
    ...(object(input.deck) ? { deck: input.deck } : {}),
    attempts: typeof input.attempts === "number" && Number.isFinite(input.attempts) ? input.attempts : 0,
    ...(typeof input.source === "string" ? { source: input.source.slice(0, 64) } : {}),
    ...(typeof input.missingReason === "string" ? { missingReason: input.missingReason.slice(0, 300) } : {}),
    ...(log.length < originalLog.length || boardLog.length < originalBoardLog.length
      || log.some(entry => object(entry) && entry.truncated) || boardLog.some(entry => object(entry) && entry.truncated)
      ? { logTruncated: true } : {}),
    ...(board && bytes(board) > MAX_PART_BYTES ? { boardOmittedReason: BOARD_OMITTED } : {}),
  };
  return JSON.stringify(diagnostics);
}
