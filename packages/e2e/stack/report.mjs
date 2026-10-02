import { spawnSync } from "node:child_process";
import { htmlReportDir, repoRoot } from "./env.mjs";

const args = process.argv.slice(2);
const reportArgs = args[0] && !args[0].startsWith("-") ? args : [htmlReportDir, ...args];
const result = spawnSync("npm", ["exec", "--workspace=packages/e2e", "--", "playwright", "show-report", ...reportArgs], {
  cwd: repoRoot, stdio: "inherit",
});
process.exitCode = result.status ?? 1;
