import assert from "node:assert/strict";
import { test } from "node:test";
import EngineSequencer from "./engine-sequencer.mjs";

test("regular files run once and all six shards run the Table file, even with a narrow selection", async () => {
  const table = { moduleId: "/duel-server/tests/multi-scripts-table.test.ts" };
  const files = Array.from({ length: 41 }, (_, index) => ({ moduleId: `/duel-server/tests/file-${index}.test.ts` }));
  for (const selected of [[...files, table], [table], files.slice(0, 2)]) {
    const shards = await Promise.all(Array.from({ length: 6 }, (_, index) => {
      const sequencer = new EngineSequencer({ config: { root: "/duel-server", shard: { index: index + 1, count: 6 } } });
      return sequencer.shard(selected);
    }));
    const regular = shards.flat().filter((file) => file !== table);
    assert.deepEqual(new Set(regular), new Set(selected.filter((file) => file !== table)));
    assert.equal(regular.length, new Set(regular).size, "regular files must not run twice");
    for (const shard of shards) assert.equal(shard.includes(table), selected.includes(table));
  }
});
