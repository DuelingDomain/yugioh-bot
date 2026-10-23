import { expect, it } from "vitest";
import { toOrdinaryReplayView } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { ReplayJsonEncoder } from "../src/replay-json.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { replaySource } from "./support/replay-fixtures.js";

describeWithCores("long replay status payload", [needs.cards(DATA), needs.scripts(DATA), needs.installedMulti(DATA)], () => {
  it("omits base stats outside MZONE throughout a 1,500-command FFA4 replay", async () => {
    const source = replaySource("ffa4");
    const game = await createEngineGame({ mode: "normal", format: "ffa4", dataDirectory: DATA,
      decks: Array.from({ length: 4 }, () => ({ main: Array(800).fill(15025844), extra: [], side: [] })),
      seed: source.seed, settings: { ...source.session.settings, validateDeck: false, shuffleDeck: false, turnSeconds: 0 },
      firstTurnDraw: false, scriptErrorMode: "tolerant" });
    const encoder = new ReplayJsonEncoder();
    let bytes = 0, offFieldBaseStats = 0, lastLog = 0, lastEvent = 0;
    try {
      for (let step = 0; step <= 1500; step++) {
        const view = game.view(null);
        const log = view.log.filter(entry => entry.id > lastLog), events = view.events.filter(entry => entry.id > lastEvent);
        for (const entry of log) lastLog = entry.id;
        for (const entry of events) lastEvent = entry.id;
        const frame = toOrdinaryReplayView({ ...view, log, events });
        bytes += (await encoder.encode(frame)).bytes;
        for (const seat of frame.seats) for (const card of [...seat.hand, ...seat.spells, ...seat.graveyard, ...seat.banished, ...seat.extra]) {
          if (card?.baseAttack != null || card?.baseDefense != null) offFieldBaseStats++;
        }
        if (step === 1500) break;
        const own = [0, 1, 2, 3].map(seat => game.view(seat)).find(view => view.prompt)!;
        expect(own, `command ${step}`).toBeDefined();
        game.answer(own.prompt!.seat, own.prompt!.id, chooseSurrenderedAnswer(own.prompt!));
      }
      process.stdout.write(`REPLAY_STATUS_SIZE ${JSON.stringify({ commands: 1500, frames: 1501, viewBytes: bytes, offFieldBaseStats })}\n`);
      expect(offFieldBaseStats).toBe(0);
    } finally { game.close(); await encoder.close(); }
  }, 120_000);
});
