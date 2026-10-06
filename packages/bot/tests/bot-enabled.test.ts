import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

it.each([undefined, "0", "true", "yes", ""])("switch %s disables bot and command registration", value => {
  for (const entry of ["index.ts", "deploy-commands.ts"]) {
    const env: NodeJS.ProcessEnv = {
      ...process.env, DOTENV_CONFIG_PATH: "/dev/null",
      DISCORD_TOKEN: "", DISCORD_CLIENT_ID: "", DISCORD_GUILD_ID: "",
    };
    if (value === undefined) delete env.DISCORD_BOT_ENABLED;
    else env.DISCORD_BOT_ENABLED = value;
    const result = spawnSync(process.execPath, ["--import", "tsx", `packages/bot/src/${entry}`], {
      cwd: root, env, encoding: "utf8", timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[bot] disabled");
    expect(result.stderr).not.toMatch(/required|login/i);
  }
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
