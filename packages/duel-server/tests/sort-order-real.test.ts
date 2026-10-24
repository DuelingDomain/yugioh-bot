import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { defaultDuelSettings, seatCountFor, type DuelAnswer, type DuelCommand, type DuelEngineChoice, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { applyJournaledCommand } from "../src/journal-command.js";
import { runJournalPrefix } from "../src/journal-runner.js";
import { buildReplayData } from "../src/replay-builder.js";
import { replaySourceVersion } from "../src/replay-cursor.js";
import { multiScriptsFolderHash, pinnedEngineVersion, repoMultiScriptsDirectory } from "../src/multi-scripts.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { replaySource } from "./support/replay-fixtures.js";

const DORIADO = 62312469, GREED = 55144522, MAGICIAN = 46986414;
const ELEMENTS = [90357090, 76812113, 85639257, 34460851]; // Earth, Wind, Water, Fire normal monsters.
const ORDER = [3, 1, 0, 2]; // Inverse is [2, 1, 3, 0]; reversing would miss the bug.
const cases = (["normal", "domain"] as const).flatMap(mode => [
  { mode, format: "1v1" as DuelFormat, engine: "legacy" as DuelEngineChoice },
  { mode, format: "1v1" as DuelFormat, engine: "pinned" as DuelEngineChoice },
  { mode, format: "ffa3" as DuelFormat, engine: "pinned" as DuelEngineChoice },
]);

describeWithCores("Dark Doriado sort order on real engines", [needs.cards(DATA), needs.scripts(DATA),
  needs.standard(DATA), needs.domain(DATA), needs.installedMulti(DATA),
  needs.file("Domain multi core", `${DATA}/ocgcore.multi-domain.wasm`),
  needs.file("legacy Domain core", `${DATA}/ocgcore.domain.legacy.wasm`)], () => {
  it.each(cases.flatMap(entry => [
    { ...entry, historical: true, mixed: false },
    { ...entry, historical: false, mixed: false },
    { ...entry, historical: true, mixed: true },
  ]))
  ("$mode $format $engine preserves draw order (historical=$historical, mixed=$mixed)", async ({ mode, format, engine, historical, mixed }) => {
    const main = [DORIADO, GREED, GREED, MAGICIAN, MAGICIAN, ...ELEMENTS, ...Array(31).fill(MAGICIAN)];
    const decks = Array.from({ length: seatCountFor(format) }, () => ({ main, extra: [], side: [],
      ...(mode === "domain" ? { deckMaster: MAGICIAN } : {}) }));
    const settings = { ...defaultDuelSettings(mode), validateDeck: false, shuffleDeck: false };
    const game = await (engine === "legacy" ? createLegacyEngineGame : createEngineGame)({
      mode, format, decks, seed: ["1", "2", "3", "4"], dataDirectory: DATA,
      settings,
      firstTurnDraw: false, scriptErrorMode: "strict",
    });
    const source = replaySource(format);
    source.session.mode = mode; source.session.settings = settings;
    source.decks = decks; source.commands = [];
    source.setup = { engine, firstTurnDraw: false, scriptErrorMode: "strict" };
    const multiScriptsDirectory = format === "1v1" ? undefined : repoMultiScriptsDirectory();
    const resources = { dataDirectory: DATA,
      bundleVersion: JSON.parse(readFileSync(`${DATA}/manifest.json`, "utf8")).bundleVersion as string,
      multiScriptsDirectory };
    source.bundleVersion = pinnedEngineVersion(resources.bundleVersion, decks.length,
      multiScriptsDirectory ? multiScriptsFolderHash(multiScriptsDirectory) : null);
    try {
      let expected: number[] | undefined;
      let summoned = false;
      for (let step = 0; step < 100; step++) {
        const views = decks.map((_, seat) => game.view(seat));
        const drawn = views[0]!.seats[0]!.hand.map(card => card.code).filter(code => ELEMENTS.includes(code!));
        if (drawn.length === 4) {
          expect(expected).toHaveLength(4);
          expect(drawn).toEqual(expected);
          const original = structuredClone(source);
          // Recovery/forks use the command transport; detached replay uses a batched worker.
          const recovered = await runJournalPrefix({ source, resources, prefixCount: source.commands.length,
            createWorker: () => new GameWorker() });
          try { expect(recovered.views.seats[0]!.seats[0]!.hand).toEqual(views[0]!.seats[0]!.hand); }
          finally { await recovered.worker.close(); }
          const replay = await buildReplayData({ source, resources, sourceVersion: replaySourceVersion(source),
            dataSeat: 0, finalView: null, createWorker: () => new GameWorker() });
          expect(replay.frames.at(-1)!.view.seats[0]!.hand).toEqual(views[0]!.seats[0]!.hand);
          expect(source).toEqual(original);
          expect(source.commands.find(input => input.command.answer.selected?.length === 4)?.command.answer.selected)
            .toEqual(ORDER.map(index => `card:${index}`));
          if (mixed) expect(new Set(source.commands.map(input => input.command.sortOrderVersion)))
            .toEqual(new Set([undefined, 1]));
          return;
        }
        const view = views.find(view => view.prompt);
        const prompt = view?.prompt;
        if (!view || !prompt || view.turn > 1) throw new Error(`Missed Doriado draw: ${JSON.stringify(view)}`);
        let answer: DuelAnswer | undefined;
        if (prompt.seat === 0) {
          const summon = prompt.options.find(option => option.id.startsWith("summon:") && option.card?.code === DORIADO);
          const greed = expected && prompt.options.find(option => option.id.startsWith("activate:") && option.card?.code === GREED);
          if (!summoned && summon) { summoned = true; answer = { choice: summon.id }; }
          else if (prompt.kind === "order") {
            expect(prompt.options.map(option => option.card?.code).sort()).toEqual([...ELEMENTS].sort());
            expected = (historical ? [2, 1, 3, 0] : ORDER).map(index => prompt.options[index]!.card!.code);
            answer = { selected: ORDER.map(index => prompt.options[index]!.id) };
          } else if (greed) answer = { choice: greed.id };
          else if (summoned && !expected && prompt.options.some(option => option.id === "yes")) answer = { choice: "yes" };
        }
        answer ??= chooseSurrenderedAnswer(prompt);
        // A historical sort may sit among newer commands after recovery/fork continuation.
        const command: DuelCommand = { revision: view.revision, promptId: prompt.id, answer,
          ...(!historical || (mixed && prompt.kind !== "order") ? { sortOrderVersion: 1 as const } : {}) };
        source.commands.push({ storedSeq: source.commands.length + 1, seat: prompt.seat, command: structuredClone(command) });
        if (historical) applyJournaledCommand(game, prompt.seat, command);
        else game.answer(prompt.seat, prompt.id, answer);
      }
      throw new Error("Doriado regression exceeded its step limit");
    } finally { game.close(); }
  }, 30_000);
});
