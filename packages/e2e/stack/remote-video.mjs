// Focused media stack: shared DB + actual ws + Next dev. No engine, worker or external auth.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = resolve(root, "packages/e2e/.stack-remote-video");
for (const port of [3310, 3312, 4312]) await new Promise((done, fail) => {
  const probe = createServer(); probe.once("error", fail);
  probe.listen(port, () => probe.close(done));
});
mkdirSync(directory, { recursive: true });
process.env.E2E_WEB_PORT = "3310";
const { seedDatabase } = await import("./seed.mjs");
const databasePath = resolve(directory, "video.sqlite");
await seedDatabase({ databasePath });
const secret = process.env.E2E_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error("Use playwright.remote-video.config.ts for throwaway auth");
const env = {
  ...process.env, DATABASE_PATH: databasePath, REMOTE_DUELS: "1",
  DISCORD_GUILD_ID: "900000000000000001", DOTENV_CONFIG_PATH: resolve(directory, "none.env"),
  WS_INTERNAL_SECRET: secret, WS_PORT: "3312", WS_INTERNAL_PORT: "4312",
  WS_INTERNAL_URL: "http://127.0.0.1:4312", WEB_URL: "http://localhost:3310", NEXT_PUBLIC_WS_URL: "http://localhost:3312",
  E2E_AUTH: "1", CLERK_SECRET_KEY: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  LIVEKIT_URL: process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? "devkey", LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? "secret",
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 10_000);
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(done => child.once("exit", done))))
    .then(() => { clearTimeout(timer); process.exit(code); });
}
process.once("SIGTERM", () => stop()); process.once("SIGINT", () => stop());
function run(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" }); children.push(child);
  child.once("error", () => stop(1)); child.once("exit", () => { if (!stopping) stop(1); });
}
run([resolve(root, "node_modules/tsx/dist/cli.mjs"), "src/server.ts"], resolve(root, "packages/ws"));
// Direct Next CLI avoids leaving npm's grandchildren behind when Playwright terminates the stack.
run([resolve(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-p", "3310"], resolve(root, "packages/web"));
