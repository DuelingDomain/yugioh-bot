/**
 * List scenarios with their tags and sources, honoring the SCENARIO_* filters.
 *   DUEL_DATA_DIR=<dir> npx tsx tests/support/list.ts
 */
import { loadAllScenarios } from "./registry.js";
import { allTags, isSelected } from "./select.js";

const all = await loadAllScenarios();
let shown = 0;
for (const { family, scenario } of all) {
  if (!isSelected(scenario)) continue;
  shown += 1;
  const tags = allTags(scenario);
  console.log(`${family}/${scenario.id}${scenario.knownBug ? "  [known bug]" : ""}\n  ${scenario.title}\n  source: ${scenario.source}\n  tags: ${tags.join(" ")}`);
}
console.log(`\n${shown} of ${all.length} scenario(s)`);
