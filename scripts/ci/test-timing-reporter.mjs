import { writeFileSync } from "node:fs";
import { relative } from "node:path";

export default class TestTimingReporter {
  files = [];

  onTestModuleEnd(module) {
    const { duration, setupDuration, collectDuration, environmentSetupDuration } = module.diagnostic();
    this.files.push({
      file: relative(process.cwd(), module.moduleId),
      seconds: Math.round(duration + setupDuration + collectDuration + environmentSetupDuration) / 1000,
    });
  }

  onTestRunEnd() {
    writeFileSync(process.env.CI_SHARD_REPORT, JSON.stringify(this.files));
  }
}
