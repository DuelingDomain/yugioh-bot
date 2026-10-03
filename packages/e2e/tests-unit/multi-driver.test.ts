import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

// The browser runner imports extensionless TS helpers, so load it through tsx.
function check(script: string): void {
  const parent = resolve(root, "packages/e2e/.stack-1/.status/e2e-multi");
  mkdirSync(parent, { recursive: true });
  const output = mkdtempSync(resolve(parent, "unit-driver-"));
  try {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { decide, planFor, PresetRun } from "./packages/e2e/helpers/multi.ts";
      ${script}
    `], { cwd: root, encoding: "utf8", env: { ...process.env, E2E_SLOT: "1", E2E_MULTI_RUN_ID: output.split("/").at(-1)! } });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

test("Hinotama checklist activates the printed card and chooses seat 2", () => check(`
  const plan = planFor("ffa3-rules-opponent-lp", ["Activate Hinotama from the human hand menu."]);
  const action = decide({ kind: "choice", options: [{ id: "activate:0", card: { name: "Hinotama" }, label: "Activate Hinotama" }] }, plan);
  assert.equal(action.note, "activate Hinotama");
  const pick = decide({ kind: "choice", options: [1, 2].map(controller => ({ id: "opt:" + controller, controller, label: "Seat " + controller })) }, plan);
  assert.equal(pick.note, "pick opponent seat 2");
`));

test("duel completion requires every planned checklist move", () => check(`
  for (const unfinished of [true, false]) {
    const run = new PresetRun({}, {}, "completion-check", "ffa3");
    run.revision = 7;
    run.wantsLeft = unfinished ? [{ verb: "activate", card: "Hinotama" }] : [];
    run.seat0 = { rec: { room: async () => ({ status: 200, body: { session: { status: "completed" }, engine: { revision: 7, turn: 63, result: { winner: 0 } } } }) } };
    await run.playUntilDone(10000, Infinity);
    assert.equal(run.status, unfinished ? "fail" : "pass");
    if (unfinished) assert.match(run.failure, /activate Hinotama/);
  }
`));

test("related rule presets use printed card names despite prose and aliases", () => check(`
  for (const [id, checklist, expected] of [
    ["ffa3-rules-opponent-field", ["Activate Raigeki through the hand menu."], ["Raigeki"]],
    ["ffa3-rules-activated-lock", ["Activate Dweller, paying its detach cost.", "Resolve Dweller, then activate Dark Hole to create simultaneous GY triggers."], ["Abyss Dweller", "Dark Hole"]],
    ["ffa3-rules-resource-rotation", ["Activate Creature Swap and choose your Elf when asked."], ["Creature Swap"]],
  ]) assert.deepEqual(planFor(id, checklist).wants.map(want => want.card), expected);
`));
