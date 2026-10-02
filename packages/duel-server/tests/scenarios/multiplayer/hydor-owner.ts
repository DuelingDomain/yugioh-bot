import { activate, defineScenario, endTurn, expectPickOptions, select, zone, type Scenario, type Step } from '../../support/dsl.js';
import { baseSetup, everySeat, type Format, type Seat } from './seat-kit.js';
import { SOURCE } from './nseat-scenarios.js';
function hydor(format: Format, actor: Seat): Scenario {
  const owner: Seat = format === 'ffa3' ? 'p2' : format === 'tag' && actor === 'p1' ? 'p2' : 'p3';
  const other: Seat = actor === 'p0' ? 'p1' : 'p0';
  const steps: Step[] = actor === 'p1' ? [endTurn('p0')] : [];
  steps.push(activate('Hydor, the Base of All Things', actor), zone(actor, 's0', actor));
  if (format !== 'tag') steps.push(expectPickOptions([
    { seat: owner, card: 'Aqua Madoor' }, { seat: owner, card: 'Mother Grizzly' },
  ], actor));
  steps.push(select('Aqua Madoor'), everySeat(format, {
    [actor]: { grave: ['Hydor, the Base of All Things'], ...(actor === 'p1' ? { hand: ['Mystical Elf'] } : {}) },
    [owner]: { monsters: ['Celtic Guardian', 'Mother Grizzly'], grave: ['Aqua Madoor'] },
    [other]: { monsters: ['Penguin Soldier'] },
  }));
  return defineScenario({
    id: `hydor-owner-${format}-${actor}`, title: `${format}: Hydor checks and returns to ${owner}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] real owner field`, rules: ['R-COMMON-SEAT-STATE'],
    tags: ['multiplayer', format, 'card:30339825'],
    setup: baseSetup(format, {
      [actor]: { hand: ['Hydor, the Base of All Things'] },
      [owner]: { grave: ['Celtic Guardian'], monsters: ['Aqua Madoor', 'Mother Grizzly'] },
      [other]: { monsters: ['Penguin Soldier'] },
    }), steps,
  });
}
export const HYDOR_OWNER_SCENARIOS = ([['ffa3', 'p0'], ['ffa4', 'p0'], ['tag', 'p0'], ['tag', 'p1']] as [Format, Seat][])
  .map(([format, actor]) => hydor(format, actor));
