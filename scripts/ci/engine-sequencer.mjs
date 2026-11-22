import { BaseSequencer } from "vitest/node";
import { fileSeconds } from "./engine-test-plan.mjs";

const relativeFile = file => file.moduleId.split("/packages/duel-server/").at(-1);

export default class EngineSequencer extends BaseSequencer {
  async sort(files) {
    // Start long files first rather than leaving one worker running at the end.
    const tableShards = Number(process.env.TABLE_SHARD?.split("/")[1]) || undefined;
    const seconds = spec => fileSeconds(relativeFile(spec), tableShards);
    return files.sort((a, b) => seconds(b) - seconds(a) || a.moduleId.localeCompare(b.moduleId));
  }
}
