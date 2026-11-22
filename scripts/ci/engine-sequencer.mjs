import { BaseSequencer } from "vitest/node";
import { COMPACT_ENGINE_SHARDS, TABLE_FILE, fileSeconds } from "./engine-test-plan.mjs";

const relativeFile = file => file.moduleId.split("/packages/duel-server/").at(-1);

export default class EngineSequencer extends BaseSequencer {
  async sort(files) {
    // Start long files first rather than leaving one worker running at the end.
    const tableShards = Number(process.env.TABLE_SHARD?.split("/")[1]) || undefined;
    const seconds = spec => {
      const file = relativeFile(spec);
      // In compact jobs the serial Table share needs to run alongside the other files.
      return tableShards === COMPACT_ENGINE_SHARDS && file === TABLE_FILE ? Infinity : fileSeconds(file, tableShards);
    };
    return files.sort((a, b) => seconds(b) - seconds(a) || a.moduleId.localeCompare(b.moduleId));
  }
}
