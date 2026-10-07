import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { GameWorker } from "../src/worker-client.js";
import { createScriptErrorRecorder, topScriptErrors } from "../src/script-error-store.js";
import { reproOptions, attackAnswer } from "./helpers/script-error-repro.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

describeWithCores("private script telemetry on failed worker replies", [needs.standard(DATA)], () => {
  it("records a strict error even though the answer fails", async () => {
    const db = new Database(":memory:"); migrate(db);
    const log: string[] = [];
    const record = createScriptErrorRecorder(db, (line) => log.push(line));
    const worker = new GameWorker((error) => record(100, error));
    try {
      await worker.create({ ...reproOptions(), scriptErrorMode: "strict" });
      let failure: unknown;
      for (let step = 0; step < 80 && !failure; step++) {
        const views = await Promise.all([worker.view(0), worker.view(1)]);
        const seat = views.findIndex((view) => view.prompt !== null);
        const prompt = views[seat]!.prompt!;
        try { await worker.answer(seat, prompt.id, attackAnswer(prompt)); }
        catch (error) { failure = error; }
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/Card script error \(strict mode\)/);
      expect((failure as Error).message).not.toMatch(/3743515|Sabersaurus|nil value/);
      expect(topScriptErrors(db)).toEqual([expect.objectContaining({ code: 3743515, count: 1, last_duel_id: 100 })]);
      expect(JSON.parse(log[0]!)).toMatchObject({ scriptErrorMode: "strict", code: 3743515 });
    } finally { await worker.close(); db.close(); }
  });
});
