// Shared constants for the isolated E2E stack. No live ports, no live files.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const e2eRoot = fileURLToPath(new URL("../", import.meta.url));
export const repoRoot = resolve(e2eRoot, "../..");
const rawSlot = process.env.E2E_SLOT;
if (rawSlot !== undefined && !/^[0-9]$/.test(rawSlot)) {
  throw new Error("E2E_SLOT must be an integer from 0 to 9 (or unset).");
}
export const e2eSlot = rawSlot === undefined ? undefined : Number(rawSlot);
export const stackDir = resolve(e2eRoot, e2eSlot === undefined ? ".stack" : `.stack-${e2eSlot}`);
export const supervisorPidFile = resolve(stackDir, "supervisor.pid");
/** One timestamped file with the output of ws, duel host and web. Tests attach the lines of a failed test. */
export const stackLogFile = resolve(stackDir, "logs/stack.log");

// Slot 0 also avoids the ordinary 3300 family; slot 9 stays below the manual 3400 family.
const defaults = e2eSlot === undefined
  ? { web: 3300, ws: 3302, wsInternal: 4302, duel: 4303 }
  : { web: 3301 + 10 * e2eSlot, ws: 3303 + 10 * e2eSlot, wsInternal: 4304 + 10 * e2eSlot, duel: 4305 + 10 * e2eSlot };
export const ports = {
  web: Number(process.env.E2E_WEB_PORT ?? defaults.web),
  ws: Number(process.env.E2E_WS_PORT ?? defaults.ws),
  wsInternal: Number(process.env.E2E_WS_INTERNAL_PORT ?? defaults.wsInternal),
  duel: Number(process.env.E2E_DUEL_PORT ?? defaults.duel),
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
  // Never seated by the four-seat specs: the unseated watcher of a full table.
  { key: "p5", discordId: "900000000000000105", name: "E2E Eve" },
];

export const dbPath = resolve(stackDir, "e2e.sqlite");
// Keep stub images out of the manual cache even when switching modes without cleanup.
export const cardImageDir = resolve(stackDir, manualMode ? "manual-card-images" : "card-images");
// Preserve legacy paths when unset. Slot output, including auth cookies, stays under its stack directory.
export const authDir = resolve(e2eSlot === undefined ? e2eRoot : stackDir, ".auth");
export const resultsDir = resolve(e2eSlot === undefined ? e2eRoot : stackDir, "test-results");
export const htmlReportDir = resolve(e2eSlot === undefined ? e2eRoot : stackDir, "playwright-report");
const statusDir = resolve(e2eSlot === undefined ? repoRoot : stackDir, ".status");
export const jsonReportFile = resolve(statusDir, "e2e-results.json");
export const multiStatusDir = resolve(statusDir, "e2e-multi");

// NEXT_PUBLIC_WS_URL is baked into each slot's independent build.
export const nextDistDir = process.env.E2E_NEXT_DIST_DIR || (e2eSlot === undefined ? ".next" : `.next-e2e-${e2eSlot}`);
export const standaloneBuildDir = resolve(repoRoot, "packages/web", nextDistDir, "standalone/packages/web");
export const buildStampFile = resolve(standaloneBuildDir, ".e2e-build.json");

export const duelDataDir =
  process.env.E2E_DUEL_DATA_DIR ?? resolve(repoRoot, "data/duel-engine-next");

/** Fresh throwaway secrets. Made once per run by the Playwright main process; workers inherit them. */
export function ensureSecrets() {
  // One id for every worker of a run, inside this slot's multiStatusDir.
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
