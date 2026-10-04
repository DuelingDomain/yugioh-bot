import assert from "node:assert/strict";
import createCore, {
  OcgDuelMode, OcgLocation, OcgMessageType, OcgPosition, OcgProcessResult,
  OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse,
} from "ocgcore-wasm";
import { loadCardDatabase } from "../../src/cards.js";
import { engineDataDirectory } from "../engine-data-dir.js";

export const RAIGEKI = 12580477;
export const SOLEMN_JUDGMENT = 41420027;
export const UPSTART_GOBLIN = 70368879;
export const DARK_MAGICIAN = 46986414;
const FILLER = 46986414;

export type ChainScenario = "negate" | "recover";

/**
 * Real cards and scripts on the stock core, every message of one chain from the activation to CHAIN_END.
 *  - "negate": P0 activates Raigeki, P1 answers with a face-down Solemn Judgment (CL2), which negates CL1.
 *  - "recover": P0 activates Upstart Goblin; P1 gains 1000 LP while it resolves.
 */
export type EngineBatch = { notes: string[]; messages: OcgMessage[] };

export async function chainResolutionBatches(scenario: ChainScenario, noteScripts: readonly string[] = []): Promise<EngineBatch[]> {
  const cards = loadCardDatabase(engineDataDirectory);
  const core = await createCore({ sync: true });
  const errors: string[] = [];
  let notes: string[] = [];
  const handle = core.createDuel({
    flags: OcgDuelMode.MODE_MR5, seed: [1n, 2n, 3n, 4n],
    team1: { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 0 },
    team2: { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 0 },
    cardReader: cards.cardData, scriptReader: cards.readScript,
    errorHandler: (_type, text) => {
      if (text.startsWith("YGD:")) notes.push(text);
      else errors.push(text);
    },
  });
  assert(handle);
  try {
    for (const name of ["constant.lua", "utility.lua"]) {
      const script = cards.readScript(name);
      assert(script);
      assert(core.loadScript(handle, name, script));
    }
    const add = (controller: 0 | 1, code: number, location: OcgLocation, sequence = 0,
      position: OcgPosition = OcgPosition.FACEUP_ATTACK) => core.duelNewCard(handle,
      { team: controller, duelist: 0, controller, code, location, sequence, position });
    for (const controller of [0, 1] as const) {
      for (let i = 0; i < 3; i += 1) add(controller, FILLER, OcgLocation.DECK, i, OcgPosition.FACEDOWN_DEFENSE);
    }
    const activationCode = scenario === "negate" ? RAIGEKI : UPSTART_GOBLIN;
    add(0, activationCode, OcgLocation.HAND);
    if (scenario === "negate") {
      add(1, DARK_MAGICIAN, OcgLocation.MZONE);
      add(1, SOLEMN_JUDGMENT, OcgLocation.SZONE, 0, OcgPosition.FACEDOWN_DEFENSE);
    }
    noteScripts.forEach((script, index) => assert(core.loadScript(handle, `chain-notes-${index}.lua`, script)));
    core.startDuel(handle);
    const batches: EngineBatch[] = [];
    for (let step = 0; step < 200; step++) {
      const status = core.duelProcess(handle);
      const batch = core.duelGetMessage(handle);
      batches.push({ notes, messages: [...batch] });
      notes = [];
      if (batch.some((message) => message.type === OcgMessageType.CHAIN_END)) {
        assert.deepEqual(errors, []);
        return batches;
      }
      assert.notEqual(status, OcgProcessResult.END, "duel ended before the chain finished");
      if (status !== OcgProcessResult.WAITING) continue;
      const prompt = batch.at(-1)!;
      let response: OcgResponse;
      switch (prompt.type) {
        case OcgMessageType.SELECT_IDLECMD: {
          const index = prompt.activates.findIndex((card) => card.code === activationCode);
          assert(index >= 0, "the scenario card must be activatable");
          response = { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
          break;
        }
        case OcgMessageType.SELECT_CHAIN: {
          const index = scenario === "negate" && prompt.player === 1 ? prompt.selects.findIndex((card) => card.code === SOLEMN_JUDGMENT) : -1;
          response = { type: OcgResponseType.SELECT_CHAIN, index: index >= 0 ? index : null };
          break;
        }
        case OcgMessageType.SELECT_PLACE:
          response = { type: OcgResponseType.SELECT_PLACE, places: [{ player: 0, location: OcgLocation.SZONE, sequence: 0 }] };
          break;
        case OcgMessageType.SELECT_YESNO:
          response = { type: OcgResponseType.SELECT_YESNO, yes: true };
          break;
        case OcgMessageType.SELECT_EFFECTYN:
          response = { type: OcgResponseType.SELECT_EFFECTYN, yes: true };
          break;
        default:
          throw new Error(`Unexpected chain prompt: ${JSON.stringify(prompt, (_key, value) => typeof value === "bigint" ? String(value) : value)}`);
      }
      core.duelSetResponse(handle, response);
    }
    throw new Error("Chain scenario exceeded its step limit");
  } finally {
    core.destroyDuel(handle);
  }
}

export async function chainResolutionMessages(scenario: ChainScenario): Promise<OcgMessage[]> {
  return (await chainResolutionBatches(scenario)).flatMap((batch) => batch.messages);
}
