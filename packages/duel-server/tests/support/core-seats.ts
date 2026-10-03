import createCore, { type OcgCardData } from "ocgcore-wasm";
import { nseatWasmBinary } from "./session.js";

/**
 * True when the N-seat core under test has the core seats of patch 0053: Duel.MPSeat, Duel.MPSeatOf and Duel.MPBindSeat.
 * The scenarios of the cards that need them (tests/scenarios/multiplayer/compare-extra-seats.test.ts) run only on such a core.
 */
export async function probeCoreSeats(): Promise<boolean> {
  try {
    const wasmBinary = nseatWasmBinary();
    if (!wasmBinary) return false;
    const lib = await createCore({ sync: true, wasmBinary });
    const team = { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 };
    const handle = lib.createDuel({
      flags: 0n,
      seed: [1n, 2n, 3n, 4n],
      team1: team,
      team2: team,
      cardReader: () => null as OcgCardData | null,
      scriptReader: () => null,
      errorHandler: () => undefined,
    });
    if (!handle) return false;
    const ok = lib.loadScript(handle, "probe.lua", "Debug.SetupDuelists(3,0,1,2) assert(Duel.MPSeat and Duel.MPSeatOf and Duel.MPBindSeat)");
    lib.destroyDuel(handle);
    return ok;
  } catch {
    return false;
  }
}
