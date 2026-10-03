import { expect } from 'vitest';
import { createEngineGame } from '../../../src/engine.js';
import { compileBoard } from '../../support/board.js';
import { describeWithCores, needs } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { Session, domainNseatWasmBinary, nseatWasmBinary } from '../../support/session.js';
import { engineDataDirectory } from '../../engine-data-dir.js';
import { choose, endTurn, normalSummon, type Scenario } from '../../support/dsl.js';
import { defineScenarioWithFfaFirstDraw as defineScenario } from './ffa-first-draw.js';
import { baseSetup, everySeat, turnsBefore, type Format, type Seat } from './seat-kit.js';
import { domainVariant } from './domain-variants.js';

const formats: Format[] = ['ffa3', 'ffa4', 'tag'];
const clearWorldGuard = `
local original=Duel.Hint
local calls=0
Duel.Hint=function(htype,player,data)
  if htype==HINT_OPSELECTED and data==aux.Stringid(33900648,3) then
    assert(player==Duel.GetTurnPlayer(),"global Clear World hint used an opponent or 1-tp instead of the real caller")
    calls=calls+1
    assert(calls==1,"global Clear World hint emitted more than one Lua call")
  end
  return original(htype,player,data)
end
`;

const clearWorld = formats.map(format => {
  const target: Seat = format === 'ffa3' ? 'p2' : 'p3';
  return defineScenario({
    id: `clear-world-hint-caller-${format}`, title: 'Clear World sends one global hint from the late real caller',
    source: 'docs/adr/0002-multiplayer-duel-rules.md', rules: ['R-COMMON-OPP-PICK', 'R-COMMON-SEP-FIELDS', ...(format === 'tag' ? ['R-TAG-LP'] : [])], tags: ['multiplayer', format, 'card:33900648'],
    setup: baseSetup(format, { [target]: { field: 'Clear World', hand: ['Flame Manipulator'] } }),
    steps: [...turnsBefore(format, target), normalSummon('Flame Manipulator', target), endTurn(target),
      choose('Take 1000 damage', target), choose('Pay 500 LP', target),
      everySeat(format, { p0: { hand: { count: 1 }, deckCount: 19 },
        p1: { hand: { count: 1 }, deckCount: 19 }, ...(format !== 'ffa3' ? { p2: { hand: { count: 1 }, deckCount: 19 } } : {}),
        [target]: { monsters: ['Flame Manipulator'], spells: ['Clear World'], lp: format === 'tag' ? 14500 : 6500, hand: { count: 1 }, deckCount: 19 } }),
    ],
  });
});

const variants = (scenarios: Scenario[]): Scenario[] => [...scenarios, ...scenarios.map(domainVariant).map(scenario => ({
  ...scenario, steps: scenario.steps.map(step => step.op !== 'expectBoard' ? step : {
    ...step, board: Object.fromEntries(Object.entries(step.board).map(([seat, state]) => [seat, {
      ...state, deckMaster: { inZone: true, returns: 0, nextCost: 0 },
    }])),
  }),
}))];

async function runPrivate(scenario: Scenario) {
  const compiled = compileBoard(scenario.setup);
  const game = await createEngineGame({ ...compiled.options,
    seed: ['1', '2', '3', '4'], dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === 'domain' ? domainNseatWasmBinary() : nseatWasmBinary(),
    ...(process.env.LEFTOVER_OVERLAY ? { multiScriptsDirectory: process.env.LEFTOVER_OVERLAY } : {}),
    ...(scenario.id.startsWith('clear-world-hint') ? { startupScripts: [...(compiled.options.startupScripts ?? []), { name: 'leftover-clear-world-hint-guard.lua', content: clearWorldGuard }] } : {}),
  });
  try {
    const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => {
      session.run(step, index + 1);
    });
    expect(game.view(0).result).toBeNull();

  } finally { game.close(); }
}

describeWithCores('live Clear World global hint caller', [liveNseat, ...needs.domainMulti()], () => {
  runScenarios('multiplayer/clear-world-hint-review', variants(clearWorld), runPrivate);
});
