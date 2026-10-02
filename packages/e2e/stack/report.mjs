import { spawnSync } from "node:child_process";
import { htmlReportDir, repoRoot } from "./env.mjs";

const result = spawnSync("npm", ["exec", "--workspace=packages/e2e", "--", "playwright", "show-report", htmlReportDir, ...process.argv.slice(2)], {
  cwd: repoRoot, stdio: "inherit",
});
process.exitCode = result.status ?? 1;
