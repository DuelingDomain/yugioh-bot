// Remote Duels screen stack. Same shape as remote-video.mjs, plus the vision data root and the STT socket.
// Focused media stack: shared DB + actual ws + Next dev. No engine, worker or external auth.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = resolve(root, "packages/e2e/.stack-remote-ui");
for (const port of [3310, 3312, 4312]) await new Promise((done, fail) => {
  const probe = createServer(); probe.once("error", fail);
  probe.listen(port, () => probe.close(done));
});
mkdirSync(directory, { recursive: true });
process.env.E2E_WEB_PORT = "3310";
const { seedDatabase } = await import("./seed.mjs");
const databasePath = resolve(directory, "ui.sqlite");
