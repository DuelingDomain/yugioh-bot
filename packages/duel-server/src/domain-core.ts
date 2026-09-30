import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type OcgLocation, type OcgCoreSync } from "ocgcore-wasm";
import type { DomainCoreFactory } from "./engine.js";
import { LOCATION_DECKMASTER, DOMAIN_LEAVE_TAX_STEP, DOMAIN_RECALL_DESC, type DomainSeatState } from "./views.js";

const LOCATION_DECKMASTER_RETURNS = 0x8000;
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readDomainWasm(dataDirectory: string, provided?: Uint8Array): ArrayBuffer {
  if (provided && provided.byteLength > 0) return toArrayBuffer(provided);
  const path = join(dataDirectory, "ocgcore.domain.wasm");
  if (!existsSync(path)) {
    throw new Error(
      "Domain wasm is missing. Build with docker.io/emscripten/emsdk:4.0.9 and packages/duel-server/scripts/build-domain-core.sh",
    );
  }
  return toArrayBuffer(new Uint8Array(readFileSync(path)));
}



export const createDomainCore: DomainCoreFactory = async (ctx) => {
  const wasmBinary = readDomainWasm(ctx.dataDirectory, ctx.wasmBinary);
  const lib = (await ctx.createStockCore({
    sync: true,
    wasmBinary,
  })) as OcgCoreSync;
  const handle = lib.createDuel({
    flags: ctx.flags,
    seed: ctx.seed,
    team1: ctx.team1,
    team2: ctx.team2,
    cardReader: ctx.cardReader,
    scriptReader: ctx.scriptReader,
    errorHandler: ctx.errorHandler,
  });
  if (!handle) throw new Error("Failed to create domain duel");

  const getDomainState = (): DomainSeatState[] => {
    return ([0, 1] as const).map((seat) => {
      // These locations are native extensions, not part of the stock enum.
      const inZone = lib.duelQueryCount(handle, seat, LOCATION_DECKMASTER as OcgLocation) > 0;
      const returns = lib.duelQueryCount(handle, seat, LOCATION_DECKMASTER_RETURNS as OcgLocation);
      const code = ctx.decks[seat].deckMaster!;
      return { inZone, code, returns, nextCost: returns * DOMAIN_LEAVE_TAX_STEP };
    });
  };

  return { lib, handle, getDomainState };
};


export const DOMAIN_LUA_NAME = "domain.lua";
export { LOCATION_DECKMASTER, LOCATION_DECKMASTER_RETURNS, DOMAIN_LEAVE_TAX_STEP, DOMAIN_RECALL_DESC };
