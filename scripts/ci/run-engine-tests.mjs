import { spawnSync } from "node:child_process";

const [selector, shard] = process.argv.slice(2);
const web = selector === "web";
if (web ? shard !== "1/1" : !["pinned", "legacy"].includes(selector) || !/^[1-6]\/6$/.test(shard ?? "")) throw new Error("Expected pinned|legacy i/6 or web 1/1");
// An unset or empty selection runs the full suite: computed fixture paths can evade static selection.
const requested = process.env.CI_TEST_FILES ? JSON.parse(process.env.CI_TEST_FILES) : undefined;
if (web && !requested) throw new Error("The web dependent run requires an explicit file selection");
const selected = requested?.length ? requested : undefined;
if (requested?.length === 0) console.warn("Empty CI test selection; falling back to the full suite.");
const table = "tests/multi-scripts-table.test.ts";
const files = selected?.filter((file) => selector !== "pinned" || file !== table) ?? ["tests"];
const run = (args, env = {}) => {
  const result = spawnSync("npm", ["exec", `--workspace=packages/${web ? "web" : "duel-server"}`, "--", "vitest", "run", ...args, ...(web ? [] : ["--testTimeout=15000"])], {
    stdio: "inherit", env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (files.length) run([
  ...files, ...(web ? [] : [`--shard=${shard}`]),
  ...(web ? [] : selector === "legacy" ? ["--config=vitest.legacy.config.ts"] : [`--exclude=${table}`]),
  ...(selected ? ["--passWithNoTests"] : []),
]);
if (selector === "pinned" && (!selected || selected.includes(table))) run([table], { TABLE_SHARD: shard });
