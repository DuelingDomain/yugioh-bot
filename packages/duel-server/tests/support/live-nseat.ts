import { needs } from "./cores.js";
import { probeSetupDuelists } from "./session.js";

/**
 * The gate of every live N-seat scenario file: NSEAT_LIVE=1 and a multi core that has Debug.SetupDuelists
 * (the same gate as tests/scenarios/multiplayer/nseat.test.ts). Pass it to describeWithCores.
 */
export const liveNseat = needs.liveNseat(process.env.NSEAT_LIVE === "1" && (await probeSetupDuelists()));
