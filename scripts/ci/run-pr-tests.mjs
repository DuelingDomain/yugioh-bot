import { spawnSync } from "node:child_process";

const [workspace, ...options] = process.argv.slice(2);
const selected = process.env.CI_TEST_FILES ? JSON.parse(process.env.CI_TEST_FILES) : null;
if (selected && (!Array.isArray(selected) || !selected.length ||
  selected.some(file => typeof file !== "string" || !file || file.startsWith("-")))) {
  throw new Error("CI_TEST_FILES must contain a nonempty list of workspace-relative test files");
}

const cwd = `--workspace=packages/${workspace}`;
const args = workspace === "duel-server"
  ? ["exec", cwd, "--", "vitest", "run", ...(selected ?? ["tests"]), "--config=vitest.unit.config.ts", "--testTimeout=15000"]
  : ["test", cwd, "--", ...(selected ?? [])];
const result = spawnSync("npm", [...args, ...options], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
