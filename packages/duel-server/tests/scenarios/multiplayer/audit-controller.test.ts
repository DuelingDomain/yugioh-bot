import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { activate, defineScenario, endTurn, pickOpponent, select } from '../../support/dsl.js';
import { baseSetup, everySeat, SEATS, type Format, type Seat } from './seat-kit.js';
import { SOURCE } from './nseat-scenarios.js';

const formats: Format[] = ['ffa3', 'ffa4', 'tag'];
const scenes = formats.flatMap(format => {
  const target: Seat = format === 'ffa3' ? 'p2' : 'p3';
  const elf = 'Mystical Elf';
  const knight = 'Gimmick Puppet Fiendish Knight';
  const phalanx = 'Centur-Ion Phalanx';
  return [
    defineScenario({
      id: `audit-fiendish-${format}`, title: `${format}: return the target to its owner`, source: SOURCE,
      rules: ['R-COMMON-SEAT-STATE'], tags: ['multiplayer', format, 'card:4145915'],
      setup: baseSetup(format, { p0: { hand: [knight] }, p1: { grave: ['Battle Ox'] }, [target]: { grave: [elf] } }),
      // R-FFA-OPP-ONE: the chosen Graveyard has one target, which the engine selects.
      steps: [activate(knight, 'p0'), format !== 'tag' ? pickOpponent(target, 'p0') : select({ card: elf, owner: target }),
        everySeat(format, { p0: { monsters: [knight], hand: [] }, p1: { grave: ['Battle Ox'] }, [target]: { monsters: [elf], grave: [] } })],
    }),
    defineScenario({
      id: `audit-phalanx-${format}`, title: `${format}: return the banished target to its owner`, source: SOURCE,
      rules: ['R-COMMON-SEAT-STATE'], tags: ['multiplayer', format, 'card:40155014'],
      setup: baseSetup(format, { p0: { spells: [{ card: phalanx, pos: 'set' }] }, [target]: { monsters: [elf] } }),
      steps: [activate(phalanx, 'p0'), everySeat(format, {p0: {grave: [phalanx]}, [target]: {banished: [elf]}}), endTurn('p0'),
        everySeat(format, { p0: { grave: [phalanx] }, [target]: { monsters: [elf], banished: [] } })],
    }),
  ];
});

describeWithCores('controller destination audit', liveNseat, () => runScenarios('audit-controller', scenes));
