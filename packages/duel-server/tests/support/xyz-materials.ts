import type { DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/engine.js";
import { createLegacyEngineGame } from "../../src/legacy/index.js";
import { engineDataDirectory } from "../engine-data-dir.js";
import { compileBoard, xyz, type BoardSpec } from "./board.js";
import { domainNseatWasmBinary, nseatWasmBinary } from "./session.js";

export const XYZ_NAME = "Number 39: Utopia";
export const XYZ_MATERIALS = ["Photon Thrasher", "Alexandrite Dragon"];

const SEATS = { "1v1": 2, ffa3: 3, ffa4: 4, tag: 4 } as const;

/** A real engine game with a face-up Xyz (two materials) in seat 0's first Monster Zone. `legacy` plays the 1v1 legacy engine. */
export async function xyzMaterialsGame(options: { format?: DuelFormat; mode: "normal" | "domain"; legacy?: boolean }): Promise<EngineGame> {
  const { format = "1v1", mode, legacy = false } = options;
  const board: BoardSpec = { mode, format };
  const ids = (["p0", "p1", "p2", "p3"] as const).slice(0, SEATS[format as keyof typeof SEATS] ?? 2);
  for (const id of ids) board[id] = { monsters: id === "p0" ? [xyz(XYZ_NAME, XYZ_MATERIALS)] : [], ...(mode === "domain" ? { deckMaster: "Celtic Guardian" } : {}) };
  const make = legacy ? createLegacyEngineGame : createEngineGame;
  return make({
    ...compileBoard(board).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    ...(format !== "1v1" ? { multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary() } : {}),
  } as never);
}
