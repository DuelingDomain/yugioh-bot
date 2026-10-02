// Playwright reporter: builds test-results/index.md after the JSON reporter wrote its file.
import { buildIndex } from "./build-index.mjs";
import { resultsDir } from "../stack/env.mjs";

export default class IndexReporter {
  printsToStdio() {
    return false;
  }
  async onEnd() {
    try {
      const rows = buildIndex();
      if (rows.length) console.log(`[e2e] ${rows.length} failed test(s). Start with ${resultsDir}/index.md`);
    } catch (error) {
      console.warn("[e2e] could not build the run index:", error);
    }
  }
}
