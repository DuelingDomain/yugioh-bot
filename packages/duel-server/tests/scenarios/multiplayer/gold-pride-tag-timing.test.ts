import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createEngineGame } from '../../../src/engine.js';
import { compileBoard } from '../../support/board.js';
import { engineDataDirectory } from '../../engine-data-dir.js';
import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { Session, nseatWasmBinary, domainNseatWasmBinary } from '../../support/session.js';
import { activate, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt,
  pickOpponent, select, yes, no, type Scenario, type DuelistId, type BoardExpect } from '../../support/dsl.js';

const CARD = 'Gold Pride - That Came Out of Nowhere!';
const LEON = 'Gold Pride - Leon';
const HAND = ['Giant Rat', 'Battle Ox', 'Axe Raider', 'Silver Fang'];
const SEATS: DuelistId[] = ['p0', 'p1', 'p2', 'p3'];
const domains = process.env.W25_MODE ? [process.env.W25_MODE === 'domain'] : [false, true];
const cases: Array<{ format: '1v1' | 'ffa3' | 'ffa4' | 'tag'; actor: number; opponent: number; accept: boolean; empty?: boolean; fromGrave?: boolean }> = [];
for (let actor = 0; actor < 4; ++actor) {
  for (let opponent = 0; opponent < 4; ++opponent) {
    if (actor % 2 === opponent % 2) continue;
    for (const accept of [true, false]) cases.push({ format: 'tag', actor, opponent, accept });
  }
}
for (const format of ['1v1', 'ffa3', 'ffa4'] as const) {
  for (const accept of [true, false]) cases.push({ format, actor: 0, opponent: format === '1v1' ? 1 : format === 'ffa3' ? 2 : 3, accept });
}
for (const opponent of [1, 3]) {
  cases.push({ format: 'tag', actor: 0, opponent, accept: false, empty: true });
  cases.push({ format: 'tag', actor: 0, opponent, accept: true, fromGrave: true });
}

describeWithCores('Gold Pride opponent selection at activation', liveNseat, () => {
  for (const domain of domains) for (const { format, actor, opponent, accept, empty, fromGrave } of cases) {
    const id = `gold-pride-${format}-p${actor}-p${opponent}-${empty ? 'empty' : fromGrave ? 'grave' : accept ? 'yes' : 'no'}-${domain ? 'domain' : 'standard'}`;
    it(id, async () => {
      const count = format === '1v1' ? 2 : format === 'ffa3' ? 3 : 4;
      const setup: Scenario['setup'] = { format, skipOpeningDraw: true, deckSize: 8, ...(domain ? { mode: 'domain' } : {}) };
      for (let i = 0; i < count; ++i) setup[SEATS[i]] = {
        hand: [...(i === opponent && (empty || fromGrave) ? [] : [HAND[i]]), ...(i === actor ? [CARD] : [])], monsters: ['Mystical Elf'],
        grave: i === actor ? [LEON] : i === opponent && fromGrave ? [HAND[i]] : [], deck: Array(8).fill('Mystical Elf'),
        ...(domain ? { deckMaster: 'Blue-Eyes White Dragon' } : {}),
      };
      const scenario = defineScenario({ id, title: id, source: 'docs/adr/0002-multiplayer-duel-rules.md',
        rules: ['R-COMMON-OPP-PICK', ...(format === 'tag' ? ['R-TAG-PARTNER'] : format === '1v1' ? [] : ['R-FFA-OPP-ONE'])],
        tags: ['multiplayer', 'gold-pride', format], setup, steps: [] });
      const compiled = compileBoard(setup);
      const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
        multiWasmBinary: domain ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ['1', '2', '3', '4'] });
      const session = new Session(scenario, game);
      let step = 1;
      const run = (s: Parameters<Session['run']>[0]) => session.run(s, step++);
      const snapshot = () => Array.from({ length: count }, (_, seat) => game.view(seat));
      let atPick: ReturnType<typeof snapshot> | undefined;
      try {
        session.reachMainPhase();
        for (let i = 0; i < actor; ++i) run(endTurn(SEATS[i]));
        session.startRecording();
        run(activate(CARD, SEATS[actor]));
        if (format !== '1v1') {
          run(expectPickSeats(SEATS.slice(0, count).filter((_, seat) => seat !== actor && (format !== 'tag' || seat % 2 !== actor % 2)), SEATS[actor]));
          atPick = snapshot();
          run(pickOpponent(SEATS[opponent], SEATS[actor]));
        }
        if (!empty) run(accept ? yes(SEATS[opponent]) : no(SEATS[opponent]));
        const prompt = snapshot().find(view => view.prompt)?.prompt;
        if (accept && prompt?.kind === 'cards') run(select({ card: HAND[opponent], owner: SEATS[opponent] }));
        const board: BoardExpect = {};
        for (let i = 0; i < count; ++i) {
          const drew = i > 0 && i <= actor ? 1 : 0;
          board[SEATS[i]] = { lp: format === 'tag' ? 16000 : 8000,
            hand: [...(i === opponent && (accept || empty || fromGrave) ? [] : [HAND[i]]), ...Array(drew).fill('Mystical Elf')],
            monsters: ['Mystical Elf', ...(i === actor ? [LEON] : []), ...(accept && i === opponent ? [HAND[i]] : [])],
            spells: [], grave: i === actor ? [CARD] : [], banished: [], extra: [], deckCount: 8 - drew,
            ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}),
          };
        }
        run(expectBoard(board));
        run(expectPrompt({ by: SEATS[actor], context: 'action' }));
        const final = snapshot();
        const resolvingAtPick = atPick?.some(view => view.events.some(event => event.kind === 'chain-resolving' && event.card?.code === 91286284)) ?? false;
        const activatedAtPick = atPick?.some(view => view.events.some(event => event.kind === 'activate' && event.card?.code === 91286284)) ?? false;
        const leonAtPick = atPick?.[actor].seats[actor].monsters.some(card => card?.name === LEON) ?? false;
        if (process.env.W25_TRACE) appendFileSync(process.env.W25_TRACE, JSON.stringify({ id, format, actor, opponent, accept, domain,
          empty, fromGrave, activatedAtPick, resolvingAtPick, leonAtPick, atPick, final, core: game.coreInfo(), diagnostics: game.diagnostics() }) + '\n');
        if (format !== '1v1') {
          expect(resolvingAtPick, 'The opponent selection must occur before chain resolution.').toBe(false);
          expect(activatedAtPick, 'The opponent selection must be part of activation.').toBe(false);
          expect(leonAtPick, 'The own summon must occur after the opponent selection.').toBe(false);
        }
        for (const view of final) expect(view.prompt?.context?.type).not.toBe('opponent');
      } finally { game.close(); }
    });
  }
});
