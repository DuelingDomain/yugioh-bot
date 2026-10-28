import { BaseSequencer } from "vitest/node";
import { duelTestFiles } from "./duel-test-files.mjs";
import { fileSeconds, pinnedPlan } from "./engine-test-plan.mjs";

const relativeFile = file => file.moduleId.split("/packages/duel-server/").at(-1);

export default class EngineSequencer extends BaseSequencer {
  async shard(files) {
    const { index, count } = this.ctx.config.shard;
    // Plan the full inventory even when Vitest received a changed-only file filter.
    const assigned = new Set(pinnedPlan(duelTestFiles().engine, count)[index - 1].files);
    return files.filter(file => assigned.has(relativeFile(file)));
  }

  async sort(files) {
    // Start long files first rather than leaving one worker running at the end.
    return files.sort((a, b) => fileSeconds(relativeFile(b)) - fileSeconds(relativeFile(a)) || a.moduleId.localeCompare(b.moduleId));
  }
}
