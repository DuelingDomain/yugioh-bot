import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runJournalPrefix } from "../src/journal-runner.js";
import { buildReplayFrames } from "../src/replay-builder.js";
import { createReplayCursorCodec, replaySourceVersion, resolveReplayCursor } from "../src/replay-cursor.js";
import { applyWorkerJournalCommand } from "../src/journal-command.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { ACCEPTANCE_CASES, acceptanceSource, CUP, fixedJournal, LINK_JOURNAL, MAGICIAN, MASTER,
  OPENING_HAND, RECALL_JOURNAL, rotationSource, SPIDER } from "./support/replay-acceptance.js";

const workers: GameWorker[] = [];
const createWorker = () => { const worker = new GameWorker(); workers.push(worker); return worker; };
afterEach(async () => { await Promise.all(workers.splice(0).map(worker => worker.close())); });
const required = [needs.cards(DATA), needs.scripts(DATA), needs.standard(DATA), needs.domain(DATA),
  needs.installedMulti(DATA), needs.file("Domain multi core", join(DATA, "ocgcore.multi-domain.wasm")),
  needs.file("legacy Domain core", join(DATA, "ocgcore.domain.legacy.wasm")),
  needs.file("legacy Domain script", join(DATA, "card-scripts/domain.legacy.lua"))];

describeWithCores("V1 fixed journal checkpoints", required, () => {
  it.each(ACCEPTANCE_CASES)("$mode $format $engine preserves fixed public and seat states, RNG and prefix counts", async entry => {
    const { source, resources } = acceptanceSource(entry), original = structuredClone(source);
    // Invisible commands occupy journal positions, and can share an engine revision.
    source.commands.unshift({ storedSeq: 2, seat: 1, command: { revision: 0, promptId: "chain-mode:off", answer: {} } });
    for (const prefixCount of [0, 1, source.commands.length]) {
      const { worker, views } = await runJournalPrefix({ source, resources, prefixCount, createWorker });
      const wasmFile = entry.format !== "1v1" ? entry.mode === "domain" ? "ocgcore.multi-domain.wasm" : "ocgcore.multi.wasm"
        : entry.engine === "legacy" ? entry.mode === "domain" ? "ocgcore.domain.legacy.wasm" : "ocgcore-wasm npm package core (built in)"
        : entry.mode === "domain" ? "ocgcore.domain.wasm" : "ocgcore.standard.wasm";
      expect(worker.debugState?.().wasmFile).toBe(wasmFile);
      expect(views.public).toMatchObject({ turn: 1, phase: "main1", result: null });
      expect(views.public.prompt).toBeNull();
      for (let seat = 0; seat < source.decks.length; seat++) {
        const own = views.seats[seat]!.seats[seat]!;
        const resolved = prefixCount === source.commands.length;
        const hand = resolved && seat === 0 ? OPENING_HAND.slice(1)
          : resolved && seat === 1 ? [...OPENING_HAND, MAGICIAN, MAGICIAN] : OPENING_HAND;
        expect(own.hand.map(card => card.code)).toEqual(hand);
        expect(own.deckCount).toBe(resolved && seat === 1 ? 33 : 35);
        expect(own.extra.map(card => card.code)).toEqual([SPIDER]);
        expect(own.lp).toBe(entry.format === "tag" ? 16000 : 8000);
        expect(views.public.seats[seat]!.hand.every(card => card.code === undefined)).toBe(true);
        expect(views.public.seats[seat]!.extra.every(card => card.code === undefined)).toBe(true);
        if (entry.mode === "domain") expect(own.deckMaster).toMatchObject({ inZone: true, returns: 0 });
      }
      expect(views.seats[1]!.chainMode).toBe(prefixCount ? "off" : "always");
      if (prefixCount === source.commands.length) {
        expect(views.public.events.filter(event => event.kind === "toss").map(event => event.toss))
          .toEqual([{ type: "coin", results: ["tails"] }]);
      } else {
        // Continue the actual paused worker. The saved RNG state must give the same Tails and draw.
        for (const command of source.commands.slice(prefixCount)) await applyWorkerJournalCommand(worker, command.seat, command.command);
        expect((await worker.view(1)).seats[1]!.deckCount).toBe(33);
        expect((await worker.view(null)).events.find(event => event.kind === "toss")?.toss)
          .toEqual({ type: "coin", results: ["tails"] });
      }
      await worker.close();
    }
    source.commands.shift(); expect(source).toEqual(original);
  }, 60_000);

  it.each(ACCEPTANCE_CASES.filter(entry => entry.format === "1v1"))
  ("$mode $engine keeps advanced RNG state after the prefix and after worker recovery", async entry => {
    const { source, resources } = acceptanceSource(entry);
    // Heads then Tails distinguishes a continued RNG from one reset to the creation seed.
    source.seed = ["18446744073709551615", "18446744073709551615", "3", "4"];
    source.commands = fixedJournal([{ choice: "activate:0" }, { selected: ["place:0"] },
      { choice: "to_ep" }, { choice: "activate:0" }, { selected: ["place:0"] }])
      .map((input, index) => ({ ...input, seat: index >= 3 ? 1 : 0 }));
    const paused = await runJournalPrefix({ source, resources, prefixCount: 2, createWorker });
    expect(paused.views.public.events.filter(event => event.kind === "toss").map(event => event.toss))
      .toEqual([{ type: "coin", results: ["heads"] }]);
    for (const input of source.commands.slice(2)) await applyWorkerJournalCommand(paused.worker, input.seat, input.command);
    const expected = { public: await paused.worker.view(null),
      seats: await Promise.all(source.decks.map((_, seat) => paused.worker.view(seat))) };
    expect(expected.public.events.filter(event => event.kind === "toss").map(event => event.toss))
      .toEqual([{ type: "coin", results: ["heads"] }, { type: "coin", results: ["tails"] }]);
    expect(expected.public.seats.map(seat => seat.deckCount)).toEqual([31, 34]);
    expect(expected.seats[0]!.seats[0]!.hand.map(card => card.code)).toEqual([...OPENING_HAND.slice(1), ...Array(4).fill(MAGICIAN)]);
    expect(expected.seats[1]!.seats[1]!.hand.map(card => card.code)).toEqual([...OPENING_HAND.slice(1), MAGICIAN]);
    await paused.worker.close();
    const recovered = await runJournalPrefix({ source, resources, prefixCount: 5, createWorker });
    expect(recovered.views).toEqual(expected);
  }, 30_000);

  it.each(ACCEPTANCE_CASES.filter(entry => entry.mode === "domain"))
  ("Domain $format $engine preserves recall choices and occupied Extra Monster Zones", async entry => {
    const { source, resources } = acceptanceSource(entry);
    source.commands = structuredClone(RECALL_JOURNAL);
    const recalled = await runJournalPrefix({ source, resources, prefixCount: 5, createWorker });
    expect(recalled.views.public.seats[0]!.deckMaster).toMatchObject({ inZone: true, returns: 1, nextCost: 500 });
    expect(recalled.views.public.seats[0]!.graveyard.some(card => card.code === MASTER)).toBe(false);
    const alternate = await runJournalPrefix({ source, resources, prefixCount: 4, createWorker });
    const prompt = alternate.views.seats[0]!.prompt!;
    expect(prompt).toMatchObject({ id: "p3-5", seat: 0, context: { type: "deck-master-recall", returns: 0, nextCost: 500 } });
    await alternate.worker.answer(0, prompt.id, { choice: "no" });
    expect((await alternate.worker.view(null)).seats[0]!.deckMaster).toMatchObject({ inZone: false, returns: 0 });
    expect((await alternate.worker.view(null)).seats[0]!.graveyard.map(card => card.code)).toContain(MASTER);
    source.commands = structuredClone(LINK_JOURNAL);
    const linked = await runJournalPrefix({ source, resources, prefixCount: source.commands.length, createWorker });
    expect(linked.views.public.seats[0]!.monsters[5]).toMatchObject({ code: SPIDER, controller: 0, sequence: 5 });
    expect(linked.views.public.seats[0]!.deckMaster).toMatchObject({ inZone: true, returns: 1, nextCost: 500 });
    expect(linked.views.public.seats.slice(1).every(seat => seat.deckMaster?.inZone && seat.deckMaster.returns === 0)).toBe(true);
  }, 60_000);

  it.each(["tag", "ffa3", "ffa4"] as const)("%s keeps a stable effect choice and clears the worker on a bad saved answer", async format => {
    const { source, resources } = acceptanceSource({ mode: "normal", format });
    // Tag chooses the opponent after the toss. FFA chooses before placement.
    const prefixCount = format === "tag" ? 2 : 1;
    const paused = await runJournalPrefix({ source, resources, prefixCount, createWorker });
    if (format === "tag") expect(paused.views.public.chain).toMatchObject([{ code: CUP, index: 1 }]);
    expect(paused.views.seats[0]!.prompt?.options.map(option => option.id)).toContain("opt:0");
    const corrupt = structuredClone(source);
    corrupt.commands[1]!.command.promptId = "bad-saved-prompt";
    let worker: GameWorker | undefined;
    await expect(runJournalPrefix({ source: corrupt, resources, prefixCount: 2,
      createWorker: () => (worker = createWorker()) })).rejects.toMatchObject({ code: "REPLAY_MISMATCH" });
    expect(worker!.running).toBe(false);
  }, 30_000);

  it.each(["normal", "domain"] as const)("%s keeps automatic loss answers inside the last copied command", async mode => {
    const { source, resources } = rotationSource(mode);
    source.commands.push(
      { storedSeq: 47, seat: 2, command: { revision: 5, promptId: "p3-5", answer: { selected: ["card:0"] } } },
      { storedSeq: 54, seat: 3, command: { revision: 6, promptId: "p5-6", answer: { selected: ["card:0"] } } },
      { storedSeq: 61, seat: 0, command: { revision: 7, promptId: "p6-7", answer: { selected: ["place:0"] } } },
    );
    // The last source answer also places the pending-loss seat's card automatically.
    const original = await runJournalPrefix({ source, resources, prefixCount: 8, createWorker });
    expect(original.views.public.prioritySeat).toBe(2);
    expect(original.views.seats[1]!.prompt).toBeNull();
    const fork = await runJournalPrefix({ source, resources, prefixCount: 8, createWorker,
      manualLossAnswersAfter: 8, target: { revision: original.views.public.revision, stateDigest: original.stateDigest } });
    expect(fork.views).toEqual(original.views);
  }, 30_000);

  it("keeps no-op cursor counts separate from visible steps and makes saved final boards non-playable", async () => {
    const { source, resources } = acceptanceSource({ mode: "normal", format: "ffa4" });
    source.commands.unshift({ storedSeq: 2, seat: 1, command: { revision: 0, promptId: "chain-mode:off", answer: {} } });
    const codec = createReplayCursorCodec("v1-acceptance-cursor"), sourceVersion = replaySourceVersion(source);
    const frames = await buildReplayFrames({ source, resources, sourceVersion, codec, dataSeat: null, finalView: null, createWorker });
    expect(frames).toHaveLength(5);
    expect(frames.slice(0, -1).map(frame => resolveReplayCursor(codec, frame.cursor!, source).prefixCount)).toEqual([0, 2, 3, 4]);
    expect(frames.at(-1)).toMatchObject({ kind: "result", cursor: null, view: { result: { reason: "Saved host interruption" } } });
    expect(workers.at(-1)!.running).toBe(false);
    const saved = structuredClone(frames.at(-1)!.view); saved.seats[0]!.lp = 1234;
    const savedFrames = await buildReplayFrames({ source, resources, sourceVersion, codec, dataSeat: null, finalView: saved, createWorker });
    expect(savedFrames.at(-1)).toMatchObject({ cursor: null, kind: "result" });
    expect(savedFrames.at(-1)!.view.seats[0]!.lp).toBe(1234);
    expect(savedFrames.at(-2)!.cursor).not.toBeNull();
  }, 30_000);

  it("refuses invalid counts, changed resources and wrong revisions before or after worker creation", async () => {
    const { source, resources } = acceptanceSource({ mode: "normal", format: "1v1", engine: "legacy" });
    for (const prefixCount of [-1, 0.5, source.commands.length + 1]) {
      await expect(runJournalPrefix({ source, resources, prefixCount, createWorker })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    }
    expect(workers).toHaveLength(0);
    await expect(runJournalPrefix({ source, resources: { ...resources, bundleVersion: "changed" }, prefixCount: 0, createWorker }))
      .rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" });
    expect(workers).toHaveLength(0);
    const corrupt = structuredClone(source); corrupt.commands[0]!.command.revision = 99;
    await expect(runJournalPrefix({ source: corrupt, resources, prefixCount: 1, createWorker })).rejects.toMatchObject({ code: "REPLAY_MISMATCH" });
    expect(workers.at(-1)!.running).toBe(false);
    await expect(runJournalPrefix({ source, resources, prefixCount: 0, createWorker, target: { revision: 99 } }))
      .rejects.toMatchObject({ code: "REPLAY_MISMATCH" });
    expect(workers.at(-1)!.running).toBe(false);
  });
});
