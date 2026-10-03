// Foreground manual stack. No Playwright tests; Ctrl+C stops the supervisor's children.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyManualDefaults } from "./manual-env.mjs";
import { assertStackStopped } from "./runtime.mjs";

applyManualDefaults();
const { livePorts, ports, repoRoot, supervisorPidFile } = await import("./env.mjs");
await assertStackStopped(supervisorPidFile, ports, livePorts);
const build = spawn(process.execPath, [fileURLToPath(new URL("./prepare.mjs", import.meta.url))], {
  cwd: repoRoot, env: process.env, stdio: "inherit",
});
let interrupted;
const onInt = () => { interrupted = "SIGINT"; build.kill("SIGINT"); };
const onTerm = () => { interrupted = "SIGTERM"; build.kill("SIGTERM"); };
process.on("SIGINT", onInt);
process.on("SIGTERM", onTerm);
let code;
try {
  code = await new Promise((done, fail) => {
    build.once("error", fail);
    build.once("close", done);
  });
} finally {
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
}
if (interrupted) process.exit(interrupted === "SIGINT" ? 130 : 143);
if (code !== 0) process.exit(code ?? 1);
await import("./start.mjs");
