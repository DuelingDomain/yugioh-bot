import { expect } from 'vitest';
import { createEngineGame } from '../../../src/engine.js';
import { compileBoard } from '../../support/board.js';
import { resolveCard } from '../../support/card-catalog.js';
import { describeWithCores, needs } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { Session, domainNseatWasmBinary, nseatWasmBinary } from '../../support/session.js';
import { engineDataDirectory } from '../../engine-data-dir.js';
import { activate, choose, endTurn, expectPrompt, pickOpponent, zone, type Scenario } from '../../support/dsl.js';
import { defineScenarioWithFfaFirstDraw as defineScenario } from './ffa-first-draw.js';
import { baseSetup, everySeat, turnsBefore, type Format, type Seat } from './seat-kit.js';
import { domainVariant } from './domain-variants.js';

const formats: Format[] = ['ffa3', 'ffa4', 'tag'];
const forks = formats.flatMap(format => {
  const target: Seat = format === 'ffa3' ? 'p2' : 'p3';
  const scenarios: Scenario[] = [defineScenario({
    id: `fork-controller-choice-${format}`, title: 'Fork declares an opponent before a named target; its controller chooses',
    source: 'docs/adr/0002-multiplayer-duel-rules.md (owner Q5: the bound opponent chooses)', rules: ['R-COMMON-SEP-FIELDS', ...(format === 'tag' ? [] : ['R-FFA-OPP-ONE'])], tags: ['multiplayer', format, 'card:19338434'],
    setup: baseSetup(format, {
      p0: { spells: [{ card: 'Mimighoul Fork', pos: 'set' }] },
      p1: { monsters: [{ card: 'Celtic Guardian', pos: 'set' }] },
      [target]: { monsters: [{ card: 'Battle Ox', pos: 'set' }, { card: 'Mystical Elf', pos: 'set' }] },
    }),
    steps: [activate('Mimighoul Fork', 'p0'),
      pickOpponent(target, 'p0'),
      expectPrompt({ by: 'p0', kind: 'cards' }), zone(target, 'm0', 'p0'),
      expectPrompt({ by: target }), choose('Send', target),
      everySeat(format, { p0: { grave: ['Mimighoul Fork'] }, p1: { monsters: ['Celtic Guardian'], hand: { count: 0 } },
        [target]: { monsters: ['Mystical Elf'], grave: ['Battle Ox'], hand: { count: 2 }, zones: { m1: { card: 'Mystical Elf', pos: 'set' } } } }),
    ],
  }), defineScenario({
    id: `fork-stolen-controller-${format}`, title: 'Fork chooser is the target controller while its real owner draws',
    source: 'docs/adr/0002-multiplayer-duel-rules.md (owner Q5: the bound opponent chooses)', rules: ['R-COMMON-SEP-FIELDS', ...(format === 'tag' ? [] : ['R-FFA-OPP-ONE'])], tags: ['multiplayer', format, 'card:19338434'],
    setup: baseSetup(format, {
      p0: { spells: [{ card: 'Mimighoul Fork', pos: 'set' }] },
      p1: { monsters: [{ card: 'Battle Ox', pos: 'set' }, { card: 'Celtic Guardian', pos: 'set' }] },
      [target]: { monsters: [null, { card: 'Mystical Elf', pos: 'set' }] },
    }),
    steps: [activate('Mimighoul Fork', 'p0'), pickOpponent(target, 'p0'),
      zone(target, 'm0', 'p0'), expectPrompt({ by: target }), choose('Send', target),
      everySeat(format, { p0: { grave: ['Mimighoul Fork'] },
        p1: { monsters: ['Celtic Guardian'], grave: ['Battle Ox'], hand: { count: 2 } },
        [target]: { monsters: ['Mystical Elf'], hand: { count: 0 }, zones: { m1: { card: 'Mystical Elf', pos: 'set' } } } }),
    ],
  }), defineScenario({
    id: `fork-draw-legality-position-${format}`, title: 'Fork cannot draw from an empty owner Deck and flips the named target',
    source: 'docs/adr/0002-multiplayer-duel-rules.md (owner Q5: the bound opponent chooses)', rules: ['R-COMMON-SEP-FIELDS', ...(format === 'tag' ? [] : ['R-FFA-OPP-ONE'])], tags: ['multiplayer', format, 'card:19338434'],
    setup: { ...baseSetup(format, {
      p0: { spells: [{ card: 'Mimighoul Fork', pos: 'set' }] },
      p1: { monsters: [{ card: 'Celtic Guardian', pos: 'set' }] },
      [target]: { hand: ['Pot of Greed'], monsters: [{ card: 'Battle Ox', pos: 'set' }, { card: 'Mystical Elf', pos: 'set' }] },
    }), deckSize: 3 },
    steps: [...turnsBefore(format, target), activate('Pot of Greed', target), endTurn(target),
      activate('Mimighoul Fork', 'p0'), pickOpponent(target, 'p0'),
      zone(target, 'm0', 'p0'), choose('Attack', 'p0'),
      everySeat(format, { p0: { grave: ['Mimighoul Fork'], hand: { count: 1 } }, p1: { monsters: ['Celtic Guardian'], hand: { count: 1 } },
        ...(format !== 'ffa3' ? { p2: { hand: { count: 1 } } } : {}),
        [target]: { monsters: ['Battle Ox', 'Mystical Elf'], grave: ['Pot of Greed'], deckCount: 0, hand: { count: 3 },
          zones: { m0: { card: 'Battle Ox', pos: 'atk' }, m1: { card: 'Mystical Elf', pos: 'set' } } } }),
    ],
  })];
  return scenarios;
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
  if (scenario.id.startsWith('fork-stolen-controller')) {
    // Debug.AddCard takes real owner and controller separately. The normal board helper uses one seat for both.
    const target = scenario.setup.format === 'ffa3' ? 2 : 3;
    const ownCard = `Debug.AddCard(${resolveCard('Battle Ox')},1,1,LOCATION_MZONE,0,`;
    for (const script of compiled.options.startupScripts ?? []) {
      if (script.content.includes(ownCard)) script.content = script.content.split('\n').map(line => {
        if (!line.startsWith(ownCard)) return line;
        const moved = line.replace(ownCard, `Debug.AddCard(${resolveCard('Battle Ox')},1,${target},LOCATION_MZONE,0,`);
        return `do local c=${moved}; local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_SINGLE); e:SetCode(EFFECT_SET_CONTROL); e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); e:SetValue(${target}); e:SetReset(RESET_EVENT|RESETS_STANDARD); c:RegisterEffect(e) end`;
      }).join('\n');
    }
  }
  const game = await createEngineGame({ ...compiled.options,
    seed: ['1', '2', '3', '4'], dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === 'domain' ? domainNseatWasmBinary() : nseatWasmBinary(),
    ...(process.env.LEFTOVER_OVERLAY ? { multiScriptsDirectory: process.env.LEFTOVER_OVERLAY } : {}),
  });
  try {
    const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => {
      session.run(step, index + 1);
    });
    expect(game.view(0).result).toBeNull();

  } finally { game.close(); }
}

describeWithCores('live Fork controller proof', [liveNseat, ...needs.domainMulti()], () => {
  runScenarios('multiplayer/fork-controller-review', variants(forks), runPrivate);
});
