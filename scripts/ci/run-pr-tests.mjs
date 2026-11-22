import { spawnSync } from "node:child_process";

const [workspace, ...options] = process.argv.slice(2);
const list = workspace === "effects" ? process.env.EFFECT_SMOKE : process.env.CI_TEST_FILES;
const selected = list ? JSON.parse(list) : null;
if (selected && (!Array.isArray(selected) || !selected.length ||
  selected.some(file => typeof file !== "string" || !file || file.startsWith("-")))) {
  throw new Error("CI_TEST_FILES must contain a nonempty list of workspace-relative test files");
}

const cwd = `--workspace=packages/${workspace}`;
let args;
if (workspace === "effects") {
  if (!selected) throw new Error("Effects smoke requires explicit test files");
  args = ["exec", "--", "vitest", "run", ...selected, "--maxWorkers=1"];
} else if (workspace === "duel-server") {
  args = ["exec", cwd, "--", "vitest", "run", ...(selected ?? ["tests"]), "--config=vitest.unit.config.ts", "--testTimeout=15000"];
} else if (workspace === "vision" && selected) {
  args = ["exec", cwd, "--", "tsx", "--test", ...selected];
} else {
  args = ["test", cwd, "--", ...(selected ?? [])];
}
const result = spawnSync("npm", [...args, ...options], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
