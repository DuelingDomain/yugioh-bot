import { expect, it } from "vitest";
import { defaultDuelSettings, seatCountFor, type DuelAnswer, type DuelEngineView, type DuelEvent, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/engine.js";
import { createEngineGame as createLegacyGame, type EngineGame as LegacyGame } from "../../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { compileBoard } from "../support/board.js";
import { activate, endTurn, type Scenario } from "../support/dsl.js";
import { Session } from "../support/session.js";
import { engineDataDirectory } from "../engine-data-dir.js";
import { describeWithCores, needs } from "../support/cores.js";

const seed = ["1", "2", "3", "4"];
type Game = Pick<EngineGame, "view" | "answer" | "close">;
type Command = { seat: number; promptId: string; answer: DuelAnswer };

function recordAnswers(game: Game, commands: Command[]): void {
  const answer = game.answer.bind(game);
  game.answer = (seat, promptId, value) => {
    answer(seat, promptId, value);
    commands.push({ seat, promptId, answer: value });
  };
}

function openPrompt(game: Game, count: number) {
  for (let seat = 0; seat < count; seat++) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  throw new Error("Expected an open prompt");
}

/** Answer only the effect's target, chain and coin choices. Stop when the core has logged its result. */
function finishToss(game: Game, count: number): void {
  for (let guard = 0; guard < 20; guard++) {
    if (game.view(null).log.some((line) => line.text.startsWith("Coin toss: "))) return;
    const { seat, prompt } = openPrompt(game, count);
    if (prompt.options.some((option) => option.id === "to_ep")) throw new Error("Returned to Main Phase without tossing");
    game.answer(seat, prompt.id, choosePracticeBotAnswer(prompt));
  }
  throw new Error("Coin effect did not finish");
}

function checkToss(view: DuelEngineView, seat: number, code: number, name: string, count: number): DuelEvent {
  const tosses = view.events.filter((event) => event.kind === "toss");
  expect(tosses).toHaveLength(1);
  const toss = tosses[0]!;
  expect(toss).toMatchObject({ seat, sourceCode: code, chainIndex: 1, card: { code, name }, toss: { type: "coin" } });
  expect(toss.toss!.results).toHaveLength(count);
  expect(toss.toss!.results.every((value) => value === "heads" || value === "tails")).toBe(true);
  const text = `Coin toss: ${toss.toss!.results.map((value) => value === "heads" ? "Heads" : "Tails").join(", ")}`;
  expect(toss.text).toBe(text);
  expect(view.log.filter((line) => line.text.startsWith("Coin toss: "))).toEqual([expect.objectContaining({ text, eventId: toss.id })]);
  const resolving = view.events.findIndex((event) => event.kind === "chain-resolving");
  const solved = view.events.findIndex((event) => event.kind === "chain-resolved");
  expect(view.events.indexOf(toss)).toBeGreaterThan(resolving);
  expect(view.events.indexOf(toss)).toBeLessThan(solved);
  return toss;
}

describeWithCores("real-core Barrel Dragon coin FX", [needs.cards(), needs.scripts(), needs.standard(), needs.installedMulti()], () => {
  it.each(["1v1", "ffa3"] as const)("%s: public 3-coin results, linked log, resync and journal replay", async (format: DuelFormat) => {
    const seat = format === "ffa3" ? 2 : 0;
    const scenario: Scenario = {
      id: `barrel-dragon-coin-${format}`, title: "Barrel Dragon emits one public three-coin event", tags: ["card:81480460"],
      source: "Barrel Dragon (81480460), official pinned card script: Duel.TossCoin(tp,3)",
      setup: {
        format,
        p0: seat === 0 ? { monsters: [81480460] } : { monsters: ["Battle Ox"] },
        p1: seat === 0 ? { monsters: ["Battle Ox"] } : {},
        ...(seat === 2 ? { p2: { monsters: [81480460] } } : {}),
      },
      steps: [],
    };
    const options = { ...compileBoard(scenario.setup).options, seed, dataDirectory: engineDataDirectory };
    const game = await createEngineGame(options);
    const commands: Command[] = [];
    recordAnswers(game, commands);
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase();
      if (seat === 2) {
        session.run(endTurn("p0"), 1);
        session.run(endTurn("p1"), 2);
      }
      session.run(activate(81480460, seat === 2 ? "p2" : "p0"), 1);
      finishToss(game, seatCountFor(format));
      const view = game.view(null);
      const toss = checkToss(view, seat, 81480460, "Barrel Dragon", 3);
      for (const viewer of Array.from({ length: seatCountFor(format) }, (_, i) => i)) {
        expect(game.view(viewer).events.find((event) => event.id === toss.id)).toEqual(toss);
        expect(game.view(viewer).log.find((line) => line.eventId === toss.id)).toEqual(view.log.find((line) => line.eventId === toss.id));
      }
      // A fresh snapshot returns history with stable ids, without emitting another toss.
      expect(game.view(null)).toEqual(view);
      const replay = await createEngineGame(options);
      try {
        for (const command of commands) replay.answer(command.seat, command.promptId, command.answer);
        expect(replay.view(null)).toEqual(view);
      } finally { replay.close(); }
    } finally { game.close(); }
  });
});

describeWithCores("real-core legacy Time Wizard coin FX", [needs.cards(), needs.scripts()], () => {
  it("1v1: reports the source and one result to both seats and spectators, including journal replay", async () => {
    const deck = { main: Array(40).fill(71625222), extra: [], side: [] };
    const options = {
      mode: "normal" as const, decks: [deck, deck], seed, dataDirectory: engineDataDirectory,
      settings: { ...defaultDuelSettings("normal"), shuffleDeck: false, validateDeck: false },
    };
    const game: LegacyGame = await createLegacyGame(options);
    const commands: Command[] = [];
    recordAnswers(game, commands);
    try {
      let summoned = false;
      for (let guard = 0; guard < 20; guard++) {
        const { seat, prompt } = openPrompt(game, 2);
        const option = prompt.options.find((item) => item.id.startsWith(summoned ? "activate:" : "summon:") && item.card?.code === 71625222);
        if (option) {
          game.answer(seat, prompt.id, { choice: option.id });
          if (summoned) break;
          summoned = true;
        } else {
          game.answer(seat, prompt.id, choosePracticeBotAnswer(prompt));
        }
      }
      finishToss(game, 2);
      const view = game.view(null);
      const toss = checkToss(view, 0, 71625222, "Time Wizard", 1);
      for (const viewer of [0, 1]) expect(game.view(viewer).events.find((event) => event.id === toss.id)).toEqual(toss);
      expect(game.view(null)).toEqual(view);
      const replay = await createLegacyGame(options);
      try {
        for (const command of commands) replay.answer(command.seat, command.promptId, command.answer);
        expect(replay.view(null)).toEqual(view);
      } finally { replay.close(); }
    } finally { game.close(); }
  });
});
