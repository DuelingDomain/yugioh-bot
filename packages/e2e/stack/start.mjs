// Supervisor for the isolated E2E stack: ws + duel host + web (production standalone build).
// Playwright starts it as one webServer and waits for the web /login page.
// Ctrl-C or SIGTERM stops all three children. Nothing here touches the live stack.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cardImageDir, dbPath, duelDataDir, ensureSecrets, guildId, livePorts, players, ports, repoRoot, stackDir, stackLogFile, webUrl, wsUrl,
} from "./env.mjs";
import { seedDatabase } from "./seed.mjs";

const secrets = ensureSecrets();
const children = [];
let stopping = false;

function portFree(port) {
  return new Promise((done) => {
    const probe = net.createServer();
    probe.once("error", () => done(false));
    probe.listen(port, () => probe.close(() => done(true)));
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    process.exit(code);
  }, 4000).unref();
  Promise.all(children.map((child) => new Promise((done) => (child.exitCode === null ? child.once("exit", done) : done())))).then(() => process.exit(code));
}
process.once("SIGTERM", () => stop(0));
process.once("SIGINT", () => stop(0));

// Every child line also goes to a file with an ISO timestamp: `<iso> <service> <line>`. The file starts empty for
// each run. A failed test attaches the lines between its start and end (helpers/evidence.ts).
let stackLog;
function logLine(name, line) {
  stackLog?.write(`${new Date().toISOString()} ${name} ${line}\n`);
}

function run(name, command, args, options) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
  const prefix = `[e2e:${name}] `;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        process.stdout.write(prefix + line + "\n");
        logLine(name, line);
      }
    });
  }
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${prefix}exited early (code ${code}, signal ${signal}). Stopping the stack.`);
      logLine(name, `exited early (code ${code}, signal ${signal})`);
      stop(1);
    }
  });
  children.push(child);
  return child;
}

for (const port of Object.values(ports)) {
  if (livePorts.includes(port)) throw new Error(`Port ${port} belongs to the live stack. Pick another E2E port.`);
  if (!(await portFree(port))) throw new Error(`Port ${port} is already in use. Stop the old E2E stack first.`);
}

// `E2E_STANDALONE_DIR` points at a copy of the web build (for example one with another baked ws port), so a second
// stack can run while the repo build is being rebuilt. Default: the repo build.
const standaloneDir = process.env.E2E_STANDALONE_DIR
  ? resolve(process.env.E2E_STANDALONE_DIR)
  : resolve(repoRoot, "packages/web/.next/standalone/packages/web");
for (const [label, file] of [
  ["web standalone build", resolve(standaloneDir, "server.js")],
  ["ws build", resolve(repoRoot, "packages/ws/dist/server.js")],
  ["duel host build", resolve(repoRoot, "packages/duel-server/dist/server.js")],
  ["duel engine data", resolve(duelDataDir, "cards.cdb")],
]) {
  if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}. Run "npm run prepare --workspace=packages/e2e" first.`);
}

mkdirSync(stackDir, { recursive: true });
mkdirSync(dirname(stackLogFile), { recursive: true });
stackLog = createWriteStream(stackLogFile, { flags: "w" });
mkdirSync(cardImageDir, { recursive: true });
await seedDatabase();

const wsInternal = `http://127.0.0.1:${ports.wsInternal}`;
// The ws and duel servers call dotenv. dotenv never overrides a variable that is set, but it adds every
// other variable from the repo .env. The ws server reads DOTENV_CONFIG_PATH, so it gets a file that does
// not exist. The duel host reads the repo .env by a fixed path, so each variable it reads is set here.
const base = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: "production",
  DATABASE_PATH: dbPath,
  DOTENV_CONFIG_PATH: resolve(stackDir, "none.env"),
  DOTENV_CONFIG_QUIET: "true",
};

run("ws", process.execPath, ["packages/ws/dist/server.js"], {
  cwd: repoRoot,
  env: { ...base, WEB_URL: webUrl, WS_PORT: String(ports.ws), WS_INTERNAL_PORT: String(ports.wsInternal), WS_INTERNAL_SECRET: secrets.ws },
});

run("duel", process.execPath, ["packages/duel-server/dist/server.js"], {
  cwd: repoRoot,
  env: {
    ...base,
    DUEL_DATA_DIR: duelDataDir,
    DUEL_INTERNAL_PORT: String(ports.duel),
    DUEL_INTERNAL_HOST: "127.0.0.1",
    DUEL_INTERNAL_SECRET: secrets.duel,
    WS_INTERNAL_URL: wsInternal,
    WS_INTERNAL_SECRET: secrets.ws,
    // Scenario presets (list-presets, start-preset, report). E2E stack only: never the dev or prod env.
    DUEL_SCENARIOS: "1",
    // The duel host report op writes here, not into the repo .status/manual. Keeps the real manual reports apart.
    DUEL_REPORT_DIR: resolve(stackDir, "reports"),
    // Fast practice bot. The default pause is 900 ms per step.
    DUEL_BOT_STEP_MS: process.env.E2E_BOT_STEP_MS ?? "120",
    // The host defaults. A live .env value must not change them.
    DUEL_ARCHIVE_AFTER_MS: String(10 * 60 * 1000),
    DUEL_IDLE_WORKER_MS: String(5 * 60 * 1000),
  },
});

const stub = fileURLToPath(new URL("./fetch-stub.mjs", import.meta.url));
run("web", process.execPath, ["server.js"], {
  cwd: standaloneDir,
  env: {
    ...base,
    PORT: String(ports.web),
    HOSTNAME: "localhost",
    NODE_OPTIONS: `--import=${stub}`,
    // Discord and auth. Dummy Discord app values: the Discord button is never used here.
    DISCORD_CLIENT_ID: "e2e-unused",
    DISCORD_CLIENT_SECRET: "e2e-unused",
    DISCORD_TOKEN: "e2e-unused-bot-token",
    DISCORD_GUILD_ID: guildId,
    NEXTAUTH_SECRET: secrets.nextauth,
    NEXTAUTH_URL: webUrl,
    AUTH_URL: webUrl,
    AUTH_TRUST_HOST: "true",
    E2E_AUTH: "1",
    E2E_AUTH_SECRET: secrets.auth,
    // Stub inputs: these fake ids count as guild members.
    E2E_STUB_GUILD_ID: guildId,
    E2E_STUB_MEMBER_IDS: players.map((player) => player.discordId).join(","),
    WS_INTERNAL_URL: wsInternal,
    WS_INTERNAL_SECRET: secrets.ws,
    DUEL_INTERNAL_URL: `http://127.0.0.1:${ports.duel}`,
    DUEL_INTERNAL_SECRET: secrets.duel,
    // The preset and report routes answer 404 without this. E2E stack only.
    DUEL_SCENARIOS: "1",
    CARD_IMAGE_CACHE_DIR: cardImageDir,
    // No BOT_ANNOUNCE_URL: the web skips Discord announcements when it is empty.
  },
});

console.log(`[e2e] stack starting: web ${webUrl}, ws ${wsUrl}, db ${dbPath}`);
