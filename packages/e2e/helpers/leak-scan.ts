import type { TestInfo } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { duelDataDir, repoRoot } from "../stack/env.mjs";
import { readJournal, type PlayerEvidence } from "./evidence";
import { findLeaks, knownSinceFromSteps, leakMessage, secretCodes, type Leak, type LeakTruth, type Viewer } from "./leaks";
import { parseTime } from "./timeline";

const run = promisify(execFile);
const REPLAY_MAX_MS = 90_000;

interface ReplayJson extends LeakTruth {
  knownStep: Record<string, Record<string, number>>;
  ok: boolean;
  failedStep: number | null;
  replayed: number;
  total: number;
  seatCount: number;
  bundleVersion: string | null;
}

/** The engine truth of a duel: replays the journal with `replay-journal.ts --json`. */
async function replayTruth(journalFile: string): Promise<ReplayJson | { error: string }> {
  const tsx = `${repoRoot}/node_modules/.bin/tsx`;
  if (!existsSync(tsx)) return { error: "tsx is not installed" };
  try {
    const { stdout } = await run(tsx, [`${repoRoot}/packages/duel-server/scripts/replay-journal.ts`, journalFile, "--json", "--data", duelDataDir], {
      cwd: repoRoot,
      timeout: REPLAY_MAX_MS,
      maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(stdout) as ReplayJson;
  } catch (error) {
    // A mismatch exits with 1 but still prints the JSON.
    const out = (error as { stdout?: string }).stdout;
    if (out?.trim().startsWith("{")) return JSON.parse(out) as ReplayJson;
    return { error: String(error).slice(0, 600) };
  }
}

export interface LeakScanResult {
  /** Error messages to fail the test with. Empty when clean, skipped or unverified. */
  errors: string[];
  file: string | null;
}

/**
 * Checks what every player's browser received against the engine truth and writes `leak-scan.json`.
 * Runs after each test (pass or fail), before the contexts close. `E2E_LEAK_SCAN=0` turns it off.
 * Status per player: "clean", "leaks", or "skipped" (with a reason). The whole scan is "unverified" when the
 * replay did not match the journal: the known sets are then partial and nothing is reported.
 */
export async function runLeakScan(testInfo: TestInfo, recorders: PlayerEvidence[]): Promise<LeakScanResult> {
  if (process.env.E2E_LEAK_SCAN === "0") return { errors: [], file: null };
  const dir = testInfo.outputPath("evidence");
  const players: Array<Record<string, unknown>> = [];
  const leaks: Leak[] = [];
  const truths = new Map<string, ReplayJson | { error: string }>();
  let replayNote: Record<string, unknown> = {};
  let unverified = false;

  for (const recorder of recorders) {
    const slug = recorder.currentSlug();
    if (!slug) continue;
    if (recorder.slugs.length > 1) {
      players.push({ player: recorder.key, status: "skipped", reason: `this player used ${recorder.slugs.length} duels in one test; the received numbers cannot be told apart` });
      continue;
    }
    // One more read: it updates the seat, and the room JSON is scanned too.
    await recorder.room(slug);
    const viewer: Viewer | null = recorder.lastRole === "spectator" ? "spectator" : recorder.lastSeat;
    if (viewer === null) {
      players.push({ player: recorder.key, slug, status: "skipped", reason: "the player has no seat and is not a spectator (lobby only?)" });
      continue;
    }
    if (!truths.has(slug)) {
      const journal = readJournal(slug);
      if ("error" in journal || !journal.seed || journal.decks.some((deck) => !deck)) {
        truths.set(slug, { error: "error" in journal ? journal.error : "the duel never started (no seed or no deck)" });
      } else {
        mkdirSync(dir, { recursive: true });
        const file = `${dir}/duel-journal-${slug}.json`;
        writeFileSync(file, JSON.stringify(journal, null, 1));
        const replay = await replayTruth(file);
        if (!("error" in replay)) replay.knownSince = knownSinceFromSteps(replay.knownStep, journal.commands.map((entry) => parseTime(entry.at)));
        truths.set(slug, replay);
      }
    }
    const truth = truths.get(slug)!;
    if ("error" in truth) {
      players.push({ player: recorder.key, slug, viewer, status: "skipped", reason: truth.error });
      continue;
    }
    replayNote = { ...replayNote, [slug]: { ok: truth.ok, failedStep: truth.failedStep, replayed: truth.replayed, total: truth.total, seatCount: truth.seatCount, bundleVersion: truth.bundleVersion } };
    if (!truth.ok) {
      unverified = true;
      players.push({ player: recorder.key, slug, viewer, status: "skipped", reason: `the replay stopped at step ${truth.failedStep}; the truth is partial` });
      continue;
    }
    const found = findLeaks(recorder.key, viewer, recorder.numbers, truth);
    leaks.push(...found);
    players.push({
      player: recorder.key,
      slug,
      viewer,
      status: found.length ? "leaks" : "clean",
      numbersSeen: recorder.numbers.hits.size,
      secretCodes: secretCodes(truth, viewer).size,
      leaks: found,
    });
  }
  if (players.length === 0) return { errors: [], file: null };

  const status = leaks.length ? "leaks" : unverified ? "unverified" : players.every((entry) => entry.status === "skipped") ? "skipped" : "clean";
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/leak-scan.json`;
  writeFileSync(file, JSON.stringify({ status, firstLeak: leaks[0] ? leakMessage(leaks[0]) : null, replay: replayNote, players }, null, 1));
  await testInfo.attach("leak-scan.json", { path: file, contentType: "application/json" });
  const first = [...leaks].sort((a, b) => a.ms - b.ms)[0];
  return { errors: first ? [leakMessage(first) + (leaks.length > 1 ? ` (${leaks.length} leaks in total, see leak-scan.json)` : "")] : [], file };
}
