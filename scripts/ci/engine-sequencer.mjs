import { BaseSequencer } from "vitest/node";
import { fileSeconds } from "./engine-test-plan.mjs";

const relativeFile = file => file.moduleId.split("/packages/duel-server/").at(-1);

export default class EngineSequencer extends BaseSequencer {
  async sort(files) {
    // Start long files first rather than leaving one worker running at the end.
    return files.sort((a, b) => fileSeconds(relativeFile(b)) - fileSeconds(relativeFile(a)) || a.moduleId.localeCompare(b.moduleId));
  }
}
