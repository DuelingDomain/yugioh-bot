import { activate, defineScenario, endTurn, select, type Scenario } from '../../support/dsl.js';
import { baseSetup, everySeat, label, turnsBefore, type Format, type Seat } from './seat-kit.js';
import { SOURCE } from './nseat-scenarios.js';

// The target's owner decides the return field. A folded controller value must not send it to another seat.
function returns(format: Format, actor: Seat, target: Seat, card: string, code: number): Scenario {
  const knight = code === 4145915;
  const ownTeam = format === 'tag' && Number(actor[1]) % 2 === Number(target[1]) % 2;
  const monster = ownTeam && knight ? 'Gimmick Puppet Humpty Dumpty' : 'Mystical Elf';
  const other: Seat = actor === 'p0' ? 'p1' : 'p0';
  const setup = knight
    ? { [actor]: { hand: [card] }, [target]: { grave: [monster] }, [other]: { grave: ['Battle Ox'] } }
    : { [actor]: { spells: [{ card, pos: 'set' }] }, [target]: { monsters: [monster] } };
  const result = knight
    ? { [actor]: { monsters: [card] }, [target]: { monsters: [monster] }, [other]: { grave: ['Battle Ox'] } }
    : { [actor]: { grave: [card] }, [target]: { monsters: [monster] } };
  return defineScenario({
    id: `owner-field-${code}-${format}-${actor}-returns-to-${target}`,
    title: `${label(format)}: ${actor} uses ${card}; the monster returns to ${target}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the real owner of the target`,
    rules: ['R-COMMON-SEAT-STATE'], tags: ['multiplayer', format, `card:${code}`],
    setup: baseSetup(format, setup),
    steps: [
      ...(knight ? turnsBefore(format, actor) : actor === 'p0' ? [] : [endTurn('p0')]), activate(card, actor),
      ...(knight ? [select({ card: monster, owner: target })] : [
        everySeat(format, { [actor]: { grave: [card] }, [target]: { banished: [monster] } }),
        endTurn('p0'),
      ]),
      everySeat(format, result),
    ],
  });
}

export const OWNER_FIELD_RETURN_SCENARIOS: Scenario[] = [
  ...([['ffa3', 'p0', 'p2'], ['ffa3', 'p1', 'p2'], ['ffa4', 'p0', 'p3'], ['ffa4', 'p1', 'p3'],
    ['tag', 'p0', 'p3'], ['tag', 'p1', 'p2'], ['tag', 'p0', 'p2'], ['tag', 'p1', 'p3']] as [Format, Seat, Seat][])
    .flatMap(([format, actor, target]) => [
      returns(format, actor, target, 'Gimmick Puppet Fiendish Knight', 4145915),
      returns(format, actor, target, 'Centur-Ion Phalanx', 40155014),
    ]),
];
