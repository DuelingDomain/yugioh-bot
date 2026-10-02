// Foreground manual stack. No Playwright tests; Ctrl+C stops the supervisor's children.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyManualDefaults } from "./manual-env.mjs";

applyManualDefaults();
const { livePorts, ports, repoRoot } = await import("./env.mjs");
for (const port of Object.values(ports)) {
  if (livePorts.includes(port)) throw new Error(`Port ${port} belongs to the live stack or preview. Pick another E2E port.`);
}
const build = spawnSync(process.execPath, [fileURLToPath(new URL("./prepare.mjs", import.meta.url))], {
  cwd: repoRoot, env: process.env, stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);
await import("./start.mjs");
