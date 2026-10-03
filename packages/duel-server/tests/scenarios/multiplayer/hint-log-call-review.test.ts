import { expect } from 'vitest';
import { createEngineGame } from '../../../src/engine.js';
import { compileBoard } from '../../support/board.js';
import { describeWithCores, needs } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { Session, domainNseatWasmBinary, nseatWasmBinary } from '../../support/session.js';
import { engineDataDirectory } from '../../engine-data-dir.js';
import { attack, endTurn, expectPrompt, type Scenario } from '../../support/dsl.js';
import { defineScenarioWithFfaFirstDraw as defineScenario } from './ffa-first-draw.js';
import { baseSetup, everySeat, turnsBefore, type Format, type Seat } from './seat-kit.js';
import { domainVariant } from './domain-variants.js';

const formats: Format[] = ['ffa3', 'ffa4', 'tag'];
const hintGuard = `
local original=Duel.Hint
local checked=false
Duel.Hint=function(htype,player,data)
  if htype==HINT_SELECTMSG and player==1 then
    local before=Duel.MPBound()
    -- Separate equal Lua calls must each keep one log line.
    original(HINT_MESSAGE,1,502)
    original(HINT_MESSAGE,1,502)
    original(HINT_EVENT,1,502)
    original(HINT_EVENT,1,502)
    -- Equal text with different recipient sets still means two separate calls.
    original(HINT_MESSAGE,0,503)
    original(HINT_MESSAGE,1,503)
    local result=original(htype,player,data)
    assert(Duel.MPBound()==before,"HINT_SELECTMSG changed the opponent binding")
    checked=true
    return result
  end
  return original(htype,player,data)
end
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CHAIN_END)
e:SetOperation(function()
  assert(checked,"official Pixie Knight target hint did not execute")
  e:Reset()
end)
Duel.RegisterEffect(e,0)
`;

const hints = formats.map(format => {
  const target: Seat = format === 'ffa3' ? 'p2' : 'p3';
  return defineScenario({
    id: `official-hint-selectmsg-${format}`, title: 'Pixie Knight hint does not bind before the actual opponent selection',
    source: 'docs/adr/0002-multiplayer-duel-rules.md', rules: ['R-COMMON-OPP-PICK', 'R-COMMON-SEP-FIELDS'], tags: ['multiplayer', format, 'card:35429292'],
    setup: baseSetup(format, { p0: { monsters: [{ card: 'Pixie Knight', pos: 'atk' }], grave: ['Pot of Greed', 'Upstart Goblin'] },
      [target]: { monsters: ['Battle Ox'] } }),
    steps: [...turnsBefore(format, target), endTurn(target), attack('Pixie Knight', { card: 'Battle Ox', owner: target }, 'p0'),
      // The battle already identifies the opponent. The hint adds no pick before its real card selection.
      expectPrompt({ by: target, kind: 'cards' }),
      { op: 'select', sels: [{ card: 'Pot of Greed', owner: 'p0', from: 'grave' }], by: target },
      everySeat(format, { p0: { grave: ['Upstart Goblin', 'Pixie Knight'], lp: format === 'tag' ? 15600 : 7600,
        deckCount: 20, hand: { count: 1 } }, [target]: { monsters: ['Battle Ox'] } }),
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
    ...(scenario.id.startsWith('official-hint') ? { startupScripts: [...(compiled.options.startupScripts ?? []), { name: 'leftover-official-hint-guard.lua', content: hintGuard }] } : {}),
  });
  try {
    const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => {
      session.run(step, index + 1);
    });
    expect(game.view(0).result).toBeNull();
    if (scenario.id.startsWith('official-hint')) {
      const lines = game.view(0).log.map(line => line.text);
      expect(lines.filter(text => text === 'Select the card(s) to destroy')).toHaveLength(4);
      expect(lines.filter(text => text === 'Select the card(s) to banish')).toHaveLength(2);
    }
  } finally { game.close(); }
}

describeWithCores('live official hint and log calls', [liveNseat, ...needs.domainMulti()], () => {
  runScenarios('multiplayer/hint-log-call-review', variants(hints), runPrivate);
});
