// Playwright reporter: builds test-results/index.md after the JSON reporter wrote its file.
import { buildIndex } from "./build-index.mjs";

export default class IndexReporter {
  printsToStdio() {
    return false;
  }
  async onEnd() {
    try {
      const rows = buildIndex();
      if (rows.length) console.log(`[e2e] ${rows.length} failed test(s). Start with packages/e2e/test-results/index.md`);
    } catch (error) {
      console.warn("[e2e] could not build the run index:", error);
    }
  }
}
