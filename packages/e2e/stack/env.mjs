// Shared constants for the isolated E2E stack. No live ports, no live files.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const e2eRoot = fileURLToPath(new URL("../", import.meta.url));
export const repoRoot = resolve(e2eRoot, "../..");
export const stackDir = resolve(e2eRoot, ".stack");
/** One timestamped file with the output of ws, duel host and web. Tests attach the lines of a failed test. */
export const stackLogFile = resolve(stackDir, "logs/stack.log");

export const ports = {
  web: Number(process.env.E2E_WEB_PORT ?? 3300),
  ws: Number(process.env.E2E_WS_PORT ?? 3302),
  wsInternal: Number(process.env.E2E_WS_INTERNAL_PORT ?? 4302),
  duel: Number(process.env.E2E_DUEL_PORT ?? 4303),
};
// The live stack uses these. The E2E stack must never use them.
export const livePorts = [3000, 3001, 3002, 3100, 3110, 4001, 4002, 4003, 4010];
export const manualMode = process.env.E2E_MANUAL === "1";
// Local login handoff; contains a throwaway secret, never log or commit it.
export const manualInfoFile = resolve(stackDir, "manual.json");

// "localhost", not 127.0.0.1: the socket connection is refused on 127.0.0.1.
export const webUrl = `http://localhost:${ports.web}`;
export const wsUrl = `http://localhost:${ports.ws}`;

export const guildId = "900000000000000001";
// Fake Discord user ids. The stub treats exactly these ids as guild members.
export const players = [
  { key: "p1", discordId: "900000000000000101", name: "E2E Alice" },
  { key: "p2", discordId: "900000000000000102", name: "E2E Bob" },
  { key: "p3", discordId: "900000000000000103", name: "E2E Carol" },
  { key: "p4", discordId: "900000000000000104", name: "E2E Dave" },
];

export const dbPath = resolve(stackDir, "e2e.sqlite");
// Keep stub images out of the manual cache even when switching modes without cleanup.
export const cardImageDir = resolve(stackDir, manualMode ? "manual-card-images" : "card-images");
/** Where the multi-seat preset runs write their evidence. `.status/` is outside git. */
export const multiStatusDir = resolve(repoRoot, ".status/e2e-multi");

export const duelDataDir =
  process.env.E2E_DUEL_DATA_DIR ?? resolve(repoRoot, "data/duel-engine-next");

/** Fresh throwaway secrets. Made once per run by the Playwright main process; workers inherit them. */
export function ensureSecrets() {
  // One id for every worker of a run: `.status/e2e-multi/<runId>/`.
  process.env.E2E_MULTI_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, "-");
  const make = () => randomBytes(24).toString("hex");
  for (const name of ["E2E_AUTH_SECRET", "E2E_NEXTAUTH_SECRET", "E2E_WS_SECRET", "E2E_DUEL_SECRET"]) {
    process.env[name] ??= make();
  }
  return {
    auth: process.env.E2E_AUTH_SECRET,
    nextauth: process.env.E2E_NEXTAUTH_SECRET,
    ws: process.env.E2E_WS_SECRET,
    duel: process.env.E2E_DUEL_SECRET,
  };
}
