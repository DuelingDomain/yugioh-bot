import { spawnSync } from "node:child_process";
import { PINNED_SHARDS, SURRENDER_FILES, DIFFERENTIAL_FILES, surrenderLeg } from "./engine-test-plan.mjs";

const [selector, shard] = process.argv.slice(2);
const web = selector === "web";
const counts = { pinned: PINNED_SHARDS, legacy: 2, surrender: 4, differential: 2, web: 1 };
const count = counts[selector];
if (!count || !new RegExp(`^[1-${count}]/${count}$`).test(shard ?? "")) throw new Error("Expected pinned i/8, surrender i/4, legacy|differential i/2 or web 1/1");
// An unset or empty selection runs the full suite: computed fixture paths can evade static selection.
const requested = process.env.CI_TEST_FILES ? JSON.parse(process.env.CI_TEST_FILES) : undefined;
if (web && !requested) throw new Error("The web dependent run requires an explicit file selection");
const selected = requested?.length ? requested : undefined;
if (requested?.length === 0) console.warn("Empty CI test selection; falling back to the full suite.");
const slow = [...SURRENDER_FILES, ...DIFFERENTIAL_FILES];
const leg = surrenderLeg(Number(shard.split("/")[0]));
const group = selector === "surrender" ? [leg.file] : selector === "differential" ? DIFFERENTIAL_FILES : undefined;
const files = group
  ? group.filter((file) => !selected || selected.includes(file))
  : selected?.filter((file) => selector !== "pinned" || !slow.includes(file)) ?? ["tests"];
const run = (args, env = {}) => {
  const result = spawnSync("npm", ["exec", `--workspace=packages/${web ? "web" : "duel-server"}`, "--", "vitest", "run", ...args, ...(web ? [] : ["--testTimeout=15000"])], {
    stdio: "inherit", env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const args = [...files, ...(selected ? ["--passWithNoTests"] : [])];
const env = {};
if (selector === "pinned") {
  args.push(`--shard=${shard}`, "--config=vitest.ci.config.ts", ...slow.map((file) => `--exclude=${file}`));
  env.TABLE_SHARD = shard;
} else if (selector === "legacy") {
  args.push(`--shard=${shard}`, "--config=vitest.legacy.config.ts");
} else if (selector === "surrender") {
  args.push(`--testNamePattern=^${leg.mode} host immediate surrender`);
} else if (selector === "differential") {
  env.DIFF_SHARD = shard;
}
if (files.length) run(args, env);
