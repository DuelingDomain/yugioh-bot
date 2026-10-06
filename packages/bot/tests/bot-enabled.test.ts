import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function disabledEnv(value: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env, DOTENV_CONFIG_PATH: "/dev/null",
    DISCORD_TOKEN: "", DISCORD_CLIENT_ID: "", DISCORD_GUILD_ID: "",
    DATABASE_PATH: "/dev/null/bot.sqlite",
  };
  if (value === undefined) delete env.DISCORD_BOT_ENABLED;
  else env.DISCORD_BOT_ENABLED = value;
  return env;
}

// Fail the real entrypoint if it tries to initialize external resources.
const setupGuard = `data:text/javascript,${encodeURIComponent(`
  import { createRequire, syncBuiltinESMExports } from "node:module";
  const require = createRequire(${JSON.stringify(`${root}package.json`)});
  const fail = () => { throw new Error("disabled bot attempted setup"); };
  require("discord.js").Client = class { constructor() { fail(); } };
  require("better-sqlite3");
  require.cache[require.resolve("better-sqlite3")].exports = class { constructor() { fail(); } };
  require("node:http").Server.prototype.listen = fail;
  syncBuiltinESMExports();
`)}`;

it.each([undefined, "0", "true", "yes", ""])("switch %s leaves bot idle until SIGTERM", async value => {
  await assertDisabledBotStops(value, "SIGTERM");
}, 15_000);

it("disabled bot exits successfully on SIGINT", async () => {
  await assertDisabledBotStops("0", "SIGINT");
}, 15_000);

async function assertDisabledBotStops(value: string | undefined, signal: NodeJS.Signals) {
  const child = spawn(process.execPath, ["--import", "tsx", "--import", setupGuard, "packages/bot/src/index.ts"], {
    cwd: root, env: disabledEnv(value), stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let spawnError: Error | undefined;
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.once("error", error => { spawnError = error; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  try {
    await expect.poll(() => stdout.includes("[bot] disabled") || spawnError !== undefined || child.exitCode !== null || child.signalCode !== null, {
      timeout: 10_000,
    }).toBe(true);
    expect(spawnError).toBeUndefined();
    await delay(250);
    expect(stdout).toBe("[bot] disabled\n");
    expect(stderr).toBe("");
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    expect(child.kill(signal)).toBe(true);
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 2_000 }).toBe(true);
    expect(await closed).toEqual({ code: 0, signal: null });
    expect(stdout).toBe("[bot] disabled\n");
    expect(stderr).toBe("");
  } finally {
    child.kill("SIGKILL");
    await closed;
  }
}

it.each([undefined, "0", "true", "yes", ""])("switch %s makes command registration exit successfully", value => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "packages/bot/src/deploy-commands.ts"], {
    cwd: root, env: disabledEnv(value), encoding: "utf8", timeout: 10_000,
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("[bot] disabled\n");
  expect(result.stderr).toBe("");
});

it.each([
  ["index.ts", "DISCORD_TOKEN is required"],
  ["deploy-commands.ts", "DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are required"],
])("literal 1 reaches required credential validation in %s", (entry, error) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", `packages/bot/src/${entry}`], {
    cwd: root,
    env: {
      ...process.env, DOTENV_CONFIG_PATH: "/dev/null", DISCORD_BOT_ENABLED: "1",
      DISCORD_TOKEN: "", DISCORD_CLIENT_ID: "", DISCORD_GUILD_ID: "",
    },
    encoding: "utf8", timeout: 10_000,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(error);
});
