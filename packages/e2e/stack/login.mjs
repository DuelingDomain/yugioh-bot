import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { livePorts, manualInfoFile, players, stackDir } from "./env.mjs";
import { authenticatePlayer } from "./login-auth.mjs";

const player = players.find((candidate) => candidate.key === process.argv[2]);
if (!player) {
  console.error("Usage: npm run stack:login --workspace=packages/e2e -- p1 (or p2, p3, p4, p5)");
  process.exit(1);
}

let info;
try {
  info = JSON.parse(readFileSync(manualInfoFile, "utf8"));
  const url = new URL(info.webUrl);
  if (url.hostname !== "localhost" || url.protocol !== "http:" || livePorts.includes(Number(url.port)) || typeof info.authSecret !== "string" || info.authSecret.length < 32) {
    throw new Error("Invalid manual stack login file");
  }
  process.kill(info.supervisorPid, 0);
} catch {
  console.error("No running manual stack found. Start npm run stack:manual --workspace=packages/e2e first.");
  process.exit(1);
}

let context;
try {
  const { chromium } = await import("@playwright/test");
  context = await chromium.launchPersistentContext(resolve(stackDir, "browsers", player.key), {
    headless: false,
    baseURL: info.webUrl,
    viewport: null,
  });
  await authenticatePlayer(context.request, player, info.authSecret, info.webUrl);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${info.webUrl}/duels/new`);
  console.log(`[manual:login] ${player.key} (${player.name}) at ${info.webUrl}. Close the browser or press Ctrl+C to quit.`);
  const close = () => { void context.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await new Promise((done) => context.once("close", done));
  process.removeListener("SIGINT", close);
  process.removeListener("SIGTERM", close);
} catch (error) {
  console.error(`[manual:login] ${error.message}`);
  process.exitCode = 1;
} finally {
  await context?.close();
}
