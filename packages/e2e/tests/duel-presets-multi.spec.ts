import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startTable } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { attachFailureEvidence } from "../helpers/evidence";
import { aggregate, openSeat, PresetRun, runDir, staticPresets, type OpenSeat } from "../helpers/multi";
import type { PlayerKey } from "../helpers/players";
import type { TimelineEntry } from "../helpers/timeline";

// Multi-seat scenario presets in a real browser (Layer 4). One test for each preset with more than 2 seats (FFA and Tag).
// Seat 0 is the test user (p1); the other seats are scripted bots of the duel host. A spectator (p2) watches.
// Every run leaves a full evidence folder: `.status/e2e-multi/<runId>/<presetId>/` (see README.md, "Multi-seat presets").
// FFA presets must mount TableShell. Tag keeps MultiSeatStage until its separate UI work lands.
//
// Run one preset:  E2E_WORKERS=1 npx playwright test duel-presets-multi -g "raigeki-dark-hole-ffa4"
// Env: E2E_STALL_MS (default 20000), E2E_MULTI_TURNS (turn to reach), E2E_MULTI_MAX_MS, E2E_MULTI_MAX_SHOTS.

// E2E_PRESET=<id>[,<id>] runs only those presets. E2E_SEED=<a,b,c,d | n> starts them with that seed (see README).
const only = (process.env.E2E_PRESET ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const multi = staticPresets().filter((preset) => preset.multi && (only.length === 0 || only.includes(preset.id)));
if (only.length > 0 && multi.length === 0) throw new Error(`E2E_PRESET matches no multi-seat preset: ${only.join(",")}`);

test.describe("multi-seat presets", () => {
  test.setTimeout(240_000);
  for (const preset of multi) {
    test(`preset ${preset.id} (${preset.format})`, async ({ browser }, testInfo) => {
      test.skip(preset.format === "tag" && only.length === 0, "Tag engine rules are outside the FFA table proof; select E2E_PRESET explicitly to run them");
      const run = new PresetRun(browser, testInfo, preset.id, preset.format);
      await run.execute();
      await run.finish();
      const failure = run.failure;
      expect(failure, failure ?? "").toBeNull();
    });
  }
});

// Visual set: every seat's page at the first prompt, for the layouts W1 (the web board) needs.
const visualSets: Array<{ format: "ffa3" | "ffa4" | "tag"; keys: PlayerKey[] }> = [
  { format: "ffa3", keys: ["p1", "p2", "p3"] },
  { format: "ffa4", keys: ["p1", "p2", "p3", "p4"] },
  { format: "tag", keys: ["p1", "p2", "p3", "p4"] },
];

test.describe("visual set", () => {
  test.setTimeout(180_000);
  test.skip(only.length > 0, "E2E_PRESET is set: only the named presets run");
  for (const set of visualSets) {
    test(`visual ${set.format}: one screenshot per seat at the first prompt`, async ({ browser }, testInfo) => {
      test.skip(set.format === "tag", "Tag keeps MultiSeatStage and is outside this FFA table proof");
      const startedAt = Date.now();
      const dir = join(runDir(), "visual", set.format);
      mkdirSync(dir, { recursive: true });
      const seats: OpenSeat[] = [];
      const errors: string[] = [];
      const notes: TimelineEntry[] = [];
      try {
        for (const key of set.keys) seats.push(await openSeat(browser, key, startedAt));
        const decks = seats.map(() => ({ main: withFiller([FILLER], 14) }));
        const table = await startTable(seats, `visual ${set.format}`, decks, { ordered: true, looseDecks: true, noBanlist: true, format: set.format });
        if (set.format !== "tag") {
          for (const seat of seats) {
            await expect(seat.page.locator(`[data-table-stage='${set.format}'] [data-seat-field]`)).toHaveCount(set.keys.length);
            await expect(seat.page.locator("[data-lp-seat]")).toHaveCount(set.keys.length);
          }
        }
        // First prompt: the room of seat 0 shows an open prompt.
        await expect
          .poll(async () => {
            const room = (await (await seats[0]!.context.request.get(`/api/duels/${encodeURIComponent(table.slug)}`)).json()) as { engine?: { prompt?: unknown } | null };
            return Boolean(room.engine?.prompt);
          }, { timeout: 30_000 })
          .toBe(true);
        await seats[0]!.page.waitForTimeout(800);
        for (const [index, seat] of seats.entries()) {
          await seat.page.screenshot({ path: join(dir, `seat${index}-${seat.key}.png`), fullPage: true, animations: "disabled" });
          const room = await seat.context.request.get(`/api/duels/${encodeURIComponent(table.slug)}`);
          writeFileSync(join(dir, `seat${index}-${seat.key}-room.json`), JSON.stringify(await room.json().catch(() => null), null, 1));
        }
      } catch (error) {
        errors.push(String(error instanceof Error ? (error.stack ?? error.message) : error).slice(0, 2000));
        for (const [index, seat] of seats.entries()) await seat.page.screenshot({ path: join(dir, `FAILED-seat${index}-${seat.key}.png`), fullPage: true, animations: "disabled", timeout: 5000 }).catch(() => undefined);
      } finally {
        if (seats.length > 0) await attachFailureEvidence(testInfo, seats.map((seat) => seat.rec), { notes, errors, outDir: join(dir, "evidence") }).catch(() => undefined);
        await Promise.all(seats.map((seat) => seat.context.close().catch(() => undefined)));
        aggregate();
      }
      expect(errors.join("\n"), `visual ${set.format}: see ${dir}`).toBe("");
    });
  }
});
