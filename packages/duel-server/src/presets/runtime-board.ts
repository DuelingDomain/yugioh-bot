import { parseSandboxBoard, SandboxBoardError, type SandboxBoard, type SandboxCardEntry } from "@yugidraft/shared/duels";
import { compileBoard, DUELIST_IDS, type CompiledBoard } from "./board.js";
import { resolveCard } from "./catalog.js";

export interface RuntimeBoardError {
  path: string;
  message: string;
}

export type RuntimeBoardValidation =
  | { ok: true; errors: []; codes: number[]; board: SandboxBoard; compiled: CompiledBoard }
  | { ok: false; errors: RuntimeBoardError[]; codes: number[] };

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Validate untrusted sandbox JSON without starting an engine. Structure comes from the shared parser;
 * every card reference must resolve to a main OCG/TCG passcode before compilation.
 * The host can return { ok, errors, codes } for validate-board. On success it can also use board and
 * compiled for start-sandbox. Persist compiled.options.firstTurnDraw with the startup scripts and seed.
 * Errors use parser field paths, or "$" for a board-wide compiler/resource error.
 */
export function validateRuntimeBoard(input: unknown, dataDirectory?: string): RuntimeBoardValidation {
  let board: SandboxBoard;
  try {
    board = parseSandboxBoard(input);
  } catch (error) {
    return { ok: false, errors: [{ path: error instanceof SandboxBoardError ? error.path : "$", message: messageOf(error) }], codes: [] };
  }

  const errors: RuntimeBoardError[] = [];
  const codes = new Set<number>();
  const check = (code: number, path: string): void => {
    try {
      codes.add(resolveCard(code, dataDirectory));
    } catch (error) {
      errors.push({ path, message: messageOf(error) });
    }
  };
  const entry = (value: SandboxCardEntry | null, path: string): void => {
    if (value === null) return;
    if (typeof value === "number") {
      check(value, path);
    } else {
      check(value.card, `${path}.card`);
      value.materials?.forEach((code, index) => check(code, `${path}.materials[${index}]`));
    }
  };

  for (const id of DUELIST_IDS) {
    const seat = board[id];
    if (!seat) continue;
    for (const zone of ["hand", "monsters", "spells", "pendulum"] as const) {
      seat[zone]?.forEach((value, index) => entry(value, `${id}.${zone}[${index}]`));
    }
    if (seat.field !== undefined) entry(seat.field, `${id}.field`);
    for (const pile of ["grave", "banished", "deck", "extra"] as const) {
      seat[pile]?.forEach((code, index) => check(code, `${id}.${pile}[${index}]`));
    }
    if (seat.deckMaster !== undefined) check(seat.deckMaster, `${id}.deckMaster`);
  }
  if (errors.length) return { ok: false, errors, codes: [...codes] };

  try {
    const compiled = compileBoard(board, dataDirectory);
    // Include refs in all CardSpec fields, even if a placement does not use those fields in Lua.
    const allCodes = [...new Set([...compiled.codes, ...codes])];
    return { ok: true, errors: [], codes: allCodes, board, compiled };
  } catch (error) {
    return { ok: false, errors: [{ path: "$", message: messageOf(error) }], codes: [...codes] };
  }
}
