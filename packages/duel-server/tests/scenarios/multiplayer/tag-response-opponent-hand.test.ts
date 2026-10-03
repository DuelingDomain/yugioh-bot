import { expect, it } from 'vitest';
import { createEngineGame } from '../../../src/engine.js';
import { compileBoard, type CardEntry } from '../../support/board.js';
import { engineDataDirectory } from '../../engine-data-dir.js';
import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { Session, nseatWasmBinary, domainNseatWasmBinary } from '../../support/session.js';
import { activate, endTurn, defineScenario, expectBoard, expectPrompt, pass, select, yes, no, pickOpponent, zone,
  choose, type BoardExpect, type Scenario, type Step, type DuelistId, type CardRef } from '../../support/dsl.js';

const SEATS: DuelistId[] = ['p0', 'p1', 'p2', 'p3'];
const CARDS = [10691144, 28454232, 29735721, 49456901, 59581480];
const own = (entry: CardEntry): CardRef => typeof entry === 'object' ? entry.card : entry;

describeWithCores('Tag responses bind the opponent who caused the response', liveNseat, () => {
  for (const code of CARDS) for (const actor of [0, 2]) for (const causer of [1, 3]) for (const domain of [false, true]) {
    const id = `tag-response-${code}-p${actor}-causer-p${causer}-${domain ? 'domain' : 'standard'}`;
    it(id, async () => {
      const setup: Scenario['setup'] = { format: 'tag', skipOpeningDraw: true, deckSize: 8,
        ...(domain ? { mode: 'domain' } : {}) };
      for (const seat of SEATS) setup[seat] = { hand: ['Giant Rat'], monsters: ['Mystical Elf'],
        deck: Array(8).fill('Mystical Elf'), ...(domain ? { deckMaster: 'Blue-Eyes White Dragon' } : {}) };
      const a = setup[SEATS[actor]]!, o = setup[SEATS[causer]]!;
      let start: Step;
      if (code === 10691144) {
        a.spells = [{ card: code, pos: 'set' }]; a.deck = Array(8).fill('Giant Rat');
        o.monsters = ['PSY-Framelord Omega']; o.hand = ['Battle Ox', 'Battle Ox']; o.deck = Array(8).fill('Battle Ox');
        start = activate('PSY-Framelord Omega', SEATS[causer]);
      } else if (code === 28454232) {
        a.monsters = [{ card: code, pos: 'set' }, 'Mystical Elf'];
        o.hand = ['Book of Moon', 'Battle Ox']; o.deck = Array(8).fill('Battle Ox');
        start = activate('Book of Moon', SEATS[causer]);
      } else if (code === 29735721) {
        a.spells = [{ card: code, pos: 'set' }]; a.hand = ['Dark Hole', 'Dark Hole'];
        o.hand = ['Mystical Space Typhoon', 'Mystical Space Typhoon']; o.deck = Array(8).fill('Mystical Space Typhoon');
        // The other opponent also has copies. A wrong binding must change that seat's board.
        const other = setup[SEATS[4 - causer]]!;
        other.hand = ['Mystical Space Typhoon', 'Giant Rat'];
        other.deck = ['Mystical Space Typhoon', ...Array(7).fill('Mystical Elf')];
        start = activate('Mystical Space Typhoon', SEATS[causer]);
      } else if (code === 49456901) {
        a.monsters = [{ card: code, materials: ['Number 104: Masquerade'] }, 'Mystical Elf'];
        o.monsters = ['Exiled Force']; o.hand = ['Battle Ox']; o.deck = Array(8).fill('Battle Ox');
        start = activate('Exiled Force', SEATS[causer]);
      } else {
        a.monsters = [code, null, 'Mystical Elf'];
        o.hand = ['Battle Ox']; o.deck = Array(8).fill('Battle Ox');
        start = endTurn(SEATS[causer]);
      }
      const scenario = defineScenario({ id, title: id, source: 'docs/adr/0002-multiplayer-duel-rules.md',
        rules: ['R-COMMON-OPP-PICK', 'R-TAG-PARTNER'], tags: ['multiplayer', 'tag', `card:${code}`], setup, steps: [] });
      const game = await createEngineGame({ ...compileBoard(setup).options, dataDirectory: engineDataDirectory,
        multiWasmBinary: domain ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ['1', '2', '3', '4'] });
      const session = new Session(scenario, game);
      let step = 1, answered = 0, armed = false;
      const run = (s: Step) => session.run(s, step++);
      const views = () => SEATS.map((_, seat) => game.view(seat));
      const prompt = () => views().find(v => v.prompt)?.prompt;
      const pump = () => {
        for (let guard = 0; guard < 60; ++guard) {
          const p = prompt();
          if (!p || p.context?.type === 'action') return;
          if (p.context?.type === 'opponent') {
            expect(code).toBe(10691144);
            expect(p.seat, 'Only Omega may choose its opponent; the response has its causing opponent.').toBe(causer);
            run(pickOpponent(SEATS[actor], SEATS[causer]));
          } else if (p.kind === 'places') {
            expect(p.seat).toBe(causer);
            expect(p.title).toBe(`Select a zone for ${code === 28454232 ? 'Book of Moon' : 'Mystical Space Typhoon'}`);
            run(zone(SEATS[causer], 's0', SEATS[causer]));
          } else if (p.context?.type === 'chain') {
            if (armed && p.seat === actor && p.options.some(option => option.card?.code === code)) {
              run(activate({ card: code, owner: SEATS[actor] }, SEATS[actor])); ++answered; armed = false;
            } else run(pass(SEATS[p.seat]));
          } else if (p.kind === 'choice' && p.options.some(option => option.id === 'yes')) {
            if (armed && p.seat === actor && p.title.includes('Elfnote Tinia')) {
              run(yes(SEATS[actor])); ++answered; armed = false;
            } else if (answered) {
              expect(p.seat, 'The response decision belongs to its actor.').toBe(actor);
              expect(p.title).toMatch(/banish|send/i);
              run(yes(SEATS[actor]));
            } else run(no(SEATS[p.seat]));
          } else if (p.kind === 'cards' || p.kind === 'toggle') {
            if (p.finishable) { game.answer(p.seat, p.id, { finish: true }); continue; }
            if (p.seat === causer && code === 28454232) {
              run(select({ card: 'Mystical Elf', owner: SEATS[actor], from: 'mzone' }));
            } else if (p.seat === causer && code === 29735721) {
              run(select({ card: code, owner: SEATS[actor], from: 'szone' }));
            } else if (p.seat === actor && code === 29735721) {
              run(select({ card: 'Dark Hole', owner: SEATS[actor], from: 'hand', nth: 0 },
                         { card: 'Dark Hole', owner: SEATS[actor], from: 'hand', nth: 0 }));
            } else if (p.seat === actor && code === 10691144 && p.title.includes('banish')) {
              run(select({ card: 'Mystical Elf', owner: SEATS[causer], from: 'mzone' }));
            } else if (p.seat === causer && code === 49456901) {
              run(select({ card: 'Mystical Elf', owner: SEATS[actor], from: 'mzone' }));
            } else if (p.seat === actor && code === 49456901) {
              run(select('Number 104: Masquerade'));
            } else throw new Error(`Unexpected card prompt: ${JSON.stringify(p)}`);
          } else if (code === 10691144 && p.kind === 'choice' && p.options.length === 2) {
            run(choose(p.options[0].id, SEATS[p.seat]));
          } else throw new Error(`Unexpected response prompt: ${JSON.stringify(p)}`);
        }
        throw new Error('The response did not reach an action prompt.');
      };
      const board: BoardExpect = {};
      for (let seat = 0; seat < 4; ++seat) {
        const initial = setup[SEATS[seat]]!, drew = seat > 0 && seat <= causer;
        board[SEATS[seat]] = { lp: 16000, hand: [...initial.hand!.map(own), ...(drew ? [own(initial.deck![0])] : [])],
          monsters: initial.monsters!.filter((entry): entry is CardEntry => entry !== null).map(own),
          spells: [], grave: [], banished: [], extra: [], deckCount: 8 - Number(drew),
          ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
      }
      const ab = board[SEATS[actor]]!, ob = board[SEATS[causer]]!;
      if (code === 10691144) {
        ab.hand = actor > 0 && actor <= causer ? ['Giant Rat'] : []; ab.grave = [code]; ab.banished = ['Giant Rat'];
        ob.hand = ['Battle Ox', 'Battle Ox']; ob.monsters = []; ob.banished = ['PSY-Framelord Omega', 'Battle Ox'];
      } else if (code === 28454232) {
        ob.hand = ['Battle Ox']; ob.grave = ['Book of Moon']; ob.banished = ['Battle Ox'];
      } else if (code === 29735721) {
        ab.hand = actor > 0 && actor <= causer ? ['Mystical Elf'] : []; ab.grave = ['Dark Hole', 'Dark Hole', code];
        ob.hand = []; ob.grave = Array(10).fill('Mystical Space Typhoon'); ob.deckCount = 0;
      } else if (code === 49456901) {
        ab.grave = ['Number 104: Masquerade']; ob.hand = ['Battle Ox']; ob.monsters = [];
        ob.grave = ['Exiled Force', 'Battle Ox']; ob.lp = 8000; board[SEATS[4 - causer]]!.lp = 8000;
      } else {
        ab.monsters = ['Mystical Elf', code]; ob.hand = ['Battle Ox']; ob.banished = ['Battle Ox'];
      }
      try {
        session.reachMainPhase();
        for (let seat = 0; seat < causer; ++seat) { run(endTurn(SEATS[seat])); session.reachMainPhase(); pump(); }
        session.startRecording(); armed = true; run(start); pump();
        expect(answered, 'The actor must activate the response exactly once.').toBe(1);
        expect(views().some(view => view.events.some(event => event.kind === 'activate' && event.card?.code === code))).toBe(true);
        expect(views().some(view => view.events.some(event => event.kind === 'chain-resolving' && event.card?.code === code))).toBe(true);
        run(expectBoard(board)); run(expectPrompt({ context: 'action' }));
        if (code === 59581480) {
          const monsters = game.view(actor).seats[actor].monsters;
          expect(monsters[0]?.name).toBe('Mystical Elf'); expect(monsters[2]?.code).toBe(code);
        }
      } catch (error) {
        console.error(JSON.stringify({ id, prompt: prompt(), states: views().map((view, seat) => view.seats[seat]), diagnostics: game.diagnostics() }));
        throw error;
      } finally { game.close(); }
    }, 30000);
  }
});
