import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { seatCountFor, type DuelAnswer, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { compileBoard } from "./support/board.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";
import { attack, changePhase, defineScenario, endTurn, faceDown, pass, pickOpponent, type DuelistId } from "./support/dsl.js";
import { Session } from "./support/session.js";

async function directAttack(format: DuelFormat, defender: number) {
  const count = seatCountFor(format);
  const seats = ["p0", "p1", "p2", "p3"].slice(0, count) as DuelistId[];
  const multi = count > 2;
  const scenario = defineScenario({
    id: `direct-attack-event-${format}-${defender}`,
    title: "A direct attack reports its defending seat to every viewer",
    source: "Production FFA direct-attack visual report",
    tags: ["attack", format],
    setup: {
      format, mode: multi ? "domain" : "normal",
      ...Object.fromEntries(seats.map(seat => [seat, multi ? { deckMaster: "Mystical Elf" } : {}])),
      p1: { monsters: ["Giant Rat"], ...(multi ? { deckMaster: "Mystical Elf" } : {}) },
      [seats[defender]]: { spells: [faceDown("Negate Attack")], ...(multi ? { deckMaster: "Mystical Elf" } : {}) },
    },
    steps: [
      ...seats.map(seat => endTurn(seat)), endTurn("p0"),
      changePhase("battle", "p1"), attack("Giant Rat", "direct", "p1"),
      ...(multi ? [pickOpponent(seats[defender], "p1")] : []),
    ],
  });
  const bytes = multi ? readFileSync(currentDomainMultiWasm()) : undefined;
  const options = {
    ...compileBoard(scenario.setup, engineDataDirectory).options,
    seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    multiWasmBinary: bytes?.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer | undefined,
  };
  const journal: Array<{ seat: number; promptId: string; answer: DuelAnswer }> = [];
  const game = await createEngineGame(options);
  const session = new Session(scenario, {
    ...game,
    answer(seat, promptId, answer) {
      game.answer(seat, promptId, answer);
      journal.push({ seat, promptId, answer });
    },
  });
  try {
    session.reachMainPhase();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
    const viewers = [...seats.map((_, seat) => seat), null];
    let views = viewers.map(viewer => game.view(viewer));
    const event = views[0].events.find(event => event.kind === "attack")!;
    expect(event).toBeDefined();
    expect(event.target).toBeUndefined();
    // The defender can respond to the declaration: no battle or damage has happened yet.
    expect(game.view(defender).prompt?.context?.type).toBe("chain");
    expect(views[0].events.some(event => event.kind === "damage")).toBe(false);
    expect(views[0].seats.map(seat => seat.lp)).toEqual(seats.map(() => 8000));
    if (multi) {
      // Real core evidence: MSG_ATTACK has no monster target; MSG_ATTACK_DUELIST (201)
      // follows it with the selected defender, independently of the later damage message.
      expect(game.diagnostics()).toContainEqual(expect.objectContaining({ kind: "msg201", seat: defender, detail: "attacked directly" }));
      for (const view of views) {
        expect(view.events.find(event => event.kind === "attack")).toMatchObject({
          seat: 1, targetSeat: defender, text: `Player 2 attacks Player ${defender + 1} directly`,
        });
        expect(view.log.some(line => line.text === `Player 2 attacks Player ${defender + 1} directly`)).toBe(true);
      }
    } else {
      expect(event.text).toBe("Player 2 declares a direct attack");
      expect(event.targetSeat).toBeUndefined();
    }
    session.run(pass(seats[defender]), scenario.steps.length + 1);
    views = viewers.map(viewer => game.view(viewer));
    expect(views[0].seats.map(seat => seat.lp)).toEqual(seats.map((_, seat) => seat === defender ? 6600 : 8000));
    // Recovery reconstructs events from the same seed and journaled answers.
    const replay = await createEngineGame(options);
    try {
      for (const entry of journal) replay.answer(entry.seat, entry.promptId, entry.answer);
      viewers.forEach((viewer, index) => expect(replay.view(viewer).events).toEqual(views[index].events));
    } finally {
      replay.close();
    }
  } finally {
    game.close();
  }
}

describeWithCores("direct-attack events from the multi-domain core", [needs.cards(engineDataDirectory), ...needs.domainMulti(engineDataDirectory)], () => {
  it.each<[DuelFormat, number]>([["ffa3", 2], ["ffa4", 3], ["ffa4", 0]])("%s reports a direct attack on seat %i to every viewer and on replay", directAttack, 30_000);
});

describeWithCores("1v1 direct-attack events", [needs.cards(engineDataDirectory), needs.standard(engineDataDirectory)], () => {
  it("keeps the existing direct-attack text and replays unchanged", () => directAttack("1v1", 0), 30_000);
});
