import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Never load local env files: inspect the production wiring before interpolation.
const config = JSON.parse(execFileSync("docker", ["compose", "--env-file", "/dev/null", "-f", "docker-compose.yml",
  "config", "--no-interpolate", "--format", "json"], { encoding: "utf8" }));
for (const name of ["web", "ws", "duel"]) {
  const env = config.services[name].environment;
  const wiring = Array.isArray(env) ? Object.fromEntries(env.map(entry => {
    const split = entry.indexOf("="); return [entry.slice(0, split), entry.slice(split + 1)];
  })) : env;
  assert.equal(wiring.DISCORD_GUILD_ID, "${DISCORD_GUILD_ID}", `${name} must receive the configured spectate guild`);
  assert.equal(wiring.OWNER_USER_IDS, "${OWNER_USER_IDS:-}", `${name} must receive the owner policy`);
}
console.log("Admin spectate Compose configuration verified for web, ws and duel.");
