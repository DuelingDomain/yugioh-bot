import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistVerdicts, type StepRecord } from "../helpers/multi-verdict.ts";

function state(revision: number, monsters: string[], hostPrompts: StepRecord["hostPrompts"] = []): StepRecord {
  return {
    step: revision + 1, revision, turn: 1, turnSeat: 0, phase: "Main Phase 1", status: "active",
    result: null, chain: [], prompt: null, hostPrompts, traceSeen: true, screenshot: null,
    board: [0, 1, 2, 3].map((seat) => ({ seat, lp: 8000, eliminated: false, team: seat,
      monsters: monsters[seat] ? [monsters[seat]!] : [], spells: [], grave: revision >= 4 && seat === 0 ? ["Celtic Guardian"] : [], handCount: 0 })),
  };
}

const driver = [{ revision: 0, note: "activate Raigeki" }, { revision: 2, note: "activate Dark Hole" }];
const initial = () => [state(0, ["Celtic Guardian", "Sangan", "Sangan", "Sangan"]), state(2, ["Celtic Guardian"]), state(4, [])];
const verdict = (steps: StepRecord[]) => checklistVerdicts("raigeki-dark-hole-ffa4", ["initial", "Raigeki", "Dark Hole", "no bot targets"], { steps, driver, format: "ffa4" })[3]!;

test("Raigeki and Dark Hole target check permits the next bot's normal action prompt", () => {
  const steps = [...initial(), state(5, [], [{ seat: 1, kind: "choice", title: "Choose an action", options: ["End Phase", "Normal Summon Mystical Elf"] }])];
  assert.equal(verdict(steps).verdict, "pass");
});

test("Raigeki and Dark Hole target check still rejects a bot target during resolution", () => {
  const steps = initial();
  steps.splice(1, 0, state(1, ["Celtic Guardian", "Sangan", "Sangan", "Sangan"], [{ seat: 1, kind: "cards", title: "Select a target", options: ["Celtic Guardian"] }]));
  assert.equal(verdict(steps).verdict, "fail");
});

function heavyStorm(steps: StepRecord[]) {
  return checklistVerdicts("ffa4-chain-order-heavy-storm", ["initial", "activate", "response order", "pass", "resolution order"], {
    steps, driver: [{ revision: 1, note: "activate Heavy Storm" }], format: "ffa4",
  });
}

test("Heavy Storm uses retained resolution events after the live chain disappears", () => {
  const step = { ...state(14, []), events: [3, 2, 1, 0].map((seat, index) => ({ kind: "chain-resolving", seat, chainIndex: 4 - index })) };
  const verdicts = heavyStorm([state(0, []), step]);
  assert.equal(verdicts[2]!.verdict, "pass");
  assert.equal(verdicts[2]!.revision, 14);
  assert.equal(verdicts[4]!.verdict, "pass");
});

test("Heavy Storm rejects wrong resolution order even with a complete live chain", () => {
  const step = { ...state(14, []), chain: [0, 1, 2, 3].map(seat => ({ seat })),
    events: [3, 1, 2, 0].map((seat, index) => ({ kind: "chain-resolving", seat, chainIndex: 4 - index })) };
  assert.equal(heavyStorm([step])[2]!.verdict, "fail");
});

test("Heavy Storm does not accept partial or unrelated one-link resolutions", () => {
  for (const events of [
    [3, 2, 1].map((seat, index) => ({ kind: "chain-resolving", seat, chainIndex: 4 - index })),
    [3, 2, 1, 0].map(seat => ({ kind: "chain-resolving", seat, chainIndex: 1 })),
  ]) assert.notEqual(heavyStorm([{ ...state(14, []), events }])[2]!.verdict, "pass");
});
