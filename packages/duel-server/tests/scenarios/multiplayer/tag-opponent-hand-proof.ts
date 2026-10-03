// Real Tag proofs for stock effects that declare an opponent after Chain resolution starts.
import { expect, it } from 'vitest';
import { createEngineGame } from '../../../src/engine.js';
import { compileBoard, type CardEntry } from '../../support/board.js';
import { engineDataDirectory } from '../../engine-data-dir.js';
import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { Session, nseatWasmBinary, domainNseatWasmBinary } from '../../support/session.js';
import { activate, normalSummon, endTurn, defineScenario, expectBoard, expectPickSeats, expectPrompt,
  pickOpponent, select, choose, yes, no, pass, zone, position, type Scenario, type BoardExpect,
  type DuelistId, type Step, type CardRef, type Zone } from '../../support/dsl.js';

const SEATS: DuelistId[] = ['p0', 'p1', 'p2', 'p3'];
const HAND = ['Giant Rat', 'Battle Ox', 'Axe Raider', 'Silver Fang'];
export type LateHandCard = 22404570 | 43632709 | 53753697 | 6325660 | 74271714;
const own = (entry: CardEntry): CardRef => typeof entry === 'object' ? entry.card : entry;

export function proveTagOpponentHand(code: LateHandCard, name: string): void {
  const cases: Array<{ format: 'tag' | 'ffa4' | '1v1'; actor: number; opponent: number; accept: boolean; banishPartner?: boolean }> = [];
  for (let actor = 0; actor < 4; ++actor) for (let opponent = 0; opponent < 4; ++opponent) {
    if (actor % 2 !== opponent % 2) for (const accept of [true, false]) cases.push({ format: 'tag', actor, opponent, accept });
  }
  for (const format of ['ffa4', '1v1'] as const) for (const accept of [true, false]) {
    cases.push({ format, actor: 0, opponent: format === 'ffa4' ? 3 : 1, accept });
  }
  if (code === 6325660) for (const accept of [true, false]) {
    cases.push({ format: 'tag', actor: 0, opponent: 3, accept, banishPartner: true });
  }
  describeWithCores(`${name}: opponent hand pick at activation`, liveNseat, () => {
    for (const domain of [false, true]) for (const { format, actor, opponent, accept, banishPartner = false } of cases) {
      const id = `tag-hand-${code}-${format}-p${actor}-p${opponent}-${accept ? 'yes' : 'no'}${banishPartner ? '-banish-partner' : ''}-${domain ? 'domain' : 'standard'}`;
      it(id, async () => {
        const count = format === '1v1' ? 2 : 4;
        const banishSeat = banishPartner ? 4 - opponent : opponent;
        const setup: Scenario['setup'] = { format, skipOpeningDraw: true, deckSize: 8, ...(domain ? { mode: 'domain' } : {}) };
        for (let i = 0; i < count; ++i) setup[SEATS[i]] = {
          hand: [HAND[i]], monsters: ['Mystical Elf'], deck: Array(8).fill('Mystical Elf'),
          ...(domain ? { deckMaster: 'Blue-Eyes White Dragon' } : {}),
        };
        const a = setup[SEATS[actor]]!;
        if (code === 22404570) {
          a.spells = [{ card: code, pos: 'set' }];
          a.monsters = ['Blue-Eyes Ultimate Dragon', 'Stardust Dragon', 'Number 39: Utopia'];
          a.grave = ['Power Patron DoomZ'];
          for (let i = 0; i < count; ++i) if (i !== actor) setup[SEATS[i]]!.hand = ['Mystical Elf'];
        } else if (code === 43632709) {
          a.hand = [code, 'Silver Fang']; a.grave = ['Nimble Momonga'];
        } else if (code === 53753697) {
          a.hand = [code];
        } else if (code === 6325660) {
          a.spells = [{ card: code, pos: 'set' }];
        } else {
          a.hand = [code, 'Dark Hole'];
          a.deck = ['Mystical Elf', '7 Colored Fish', '7 Colored Fish', ...Array(5).fill('Mystical Elf')];
          // Both Tag opponents have two cards, so either remains a legal choice.
          for (let i = 0; i < count; ++i) if (i !== actor) setup[SEATS[i]]!.hand = [HAND[i], 'Dark Hole'];
        }
        const scenario = defineScenario({ id, title: id, source: 'docs/adr/0002-multiplayer-duel-rules.md',
          rules: ['R-COMMON-OPP-PICK', ...(format === 'tag' ? ['R-TAG-PARTNER', ...([22404570, 6325660].includes(code) ? ['R-TAG-SHARED-CARDS'] : [])] : format === 'ffa4' ? ['R-FFA-OPP-ONE'] : [])],
          tags: ['multiplayer', 'tag-hand', `card:${code}`, format], setup, steps: [] });
        const game = await createEngineGame({ ...compileBoard(setup).options, dataDirectory: engineDataDirectory,
          multiWasmBinary: domain ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ['1', '2', '3', '4'] });
        const session = new Session(scenario, game);
        let step = 1;
        const run = (s: Step) => session.run(s, step++);
        const views = () => Array.from({ length: count }, (_, i) => game.view(i));
        const prompt = () => views().find(v => v.prompt)?.prompt;
        let atPick: ReturnType<typeof views> | undefined;
        let picked = 0;
        const decisions = new Set<string>();
        const needPrompt = (seat: number, title: string) => run(expectPrompt({ by: SEATS[seat], title }));
        const board: BoardExpect = {};
        for (let i = 0; i < count; ++i) {
          const s = setup[SEATS[i]]!;
          const drew = i > 0 && i <= actor ? 1 : 0;
          board[SEATS[i]] = { lp: format === 'tag' ? 16000 : 8000,
            hand: [...(s.hand ?? []).map(own), ...Array(drew).fill('Mystical Elf')],
            monsters: (s.monsters ?? []).filter((x): x is CardEntry => x !== null).map(own),
            spells: [], grave: [...(s.grave ?? [])], banished: [], extra: [], deckCount: 8 - drew,
            ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}),
          };
        }
        // Expected changes follow the stock card text. All other seats keep their cards.
        const ab = board[SEATS[actor]]!, ob = board[SEATS[opponent]]!;
        const draws = actor > 0 ? ['Mystical Elf'] : [];
        if (code === 22404570) {
          ab.monsters = [...a.monsters!.map(x => own(x!)), 'Power Patron DoomZ']; ab.grave = [code];
          if (accept) { ob.monsters = []; ob.hand = opponent > 0 && opponent <= actor ? ['Mystical Elf'] : [];
            ob.banished = ['Mystical Elf', 'Mystical Elf', 'Mystical Elf', 'Mystical Elf', 'Mystical Elf'];
            ob.deckCount = (ob.deckCount as number) - 3; }
        } else if (code === 43632709) {
          ab.hand = draws; ab.monsters = ['Mystical Elf', code, 'Nimble Momonga']; ab.grave = []; ab.banished = ['Silver Fang'];
        } else if (code === 53753697) {
          ab.hand = draws; ab.monsters = ['Mystical Elf', code];
        } else if (code === 6325660) {
          ab.grave = [code]; board[SEATS[banishSeat]]!.monsters = []; board[SEATS[banishSeat]]!.banished = ['Mystical Elf'];
        } else {
          ab.hand = draws; ab.grave = [code]; ab.banished = ['Dark Hole'];
          if (accept) ob.hand = opponent > 0 && opponent <= actor ? ['Mystical Elf'] : [];
          if (accept) ob.banished = [HAND[opponent], 'Dark Hole'];
          else { ab.grave = [code, '7 Colored Fish', '7 Colored Fish']; ab.deckCount = (ab.deckCount as number) - 2; }
        }
        if (accept && [43632709, 53753697, 6325660].includes(code)) {
          ob.hand = opponent > 0 && opponent <= actor ? ['Mystical Elf'] : [];
          ob.monsters = [...(code === 6325660 && banishSeat === opponent ? [] : ['Mystical Elf']), HAND[opponent]];
        }
        try {
          session.reachMainPhase();
          for (let i = 0; i < actor; ++i) {
            run(endTurn(SEATS[i]));
            for (let guard = 0; guard < 60 && prompt()?.context?.type === 'chain'; ++guard) run(pass(SEATS[prompt()!.seat]));
            run(expectPrompt({ by: SEATS[i + 1], context: 'action' }));
          }
          session.startRecording();
          run(code === 43632709 ? normalSummon(code, SEATS[actor]) : activate(code, SEATS[actor]));
          // Answer only known stock prompts. An unexpected prompt fails the proof.
          for (let guard = 0; guard < 40; ++guard) {
            const p = prompt();
            if (!p || p.context?.type === 'action') break;
            if (p.context?.type === 'opponent') {
              expect(++picked, 'The effect must select one opponent only.').toBe(1);
              run(expectPickSeats(SEATS.slice(0, count).filter((_, i) => i !== actor && (format !== 'tag' || i % 2 !== actor % 2)), SEATS[actor]));
              atPick = views();
              run(pickOpponent(SEATS[opponent], SEATS[actor]));
            } else if (p.context?.type === 'chain') run(pass(SEATS[p.seat]));
            else if (p.kind === 'places' || p.context?.type === 'position') {
              const ownNames = [name, ...(code === 22404570 ? ['Power Patron DoomZ'] : code === 43632709 ? ['Nimble Momonga'] : [])];
              const card = [...ownNames, HAND[opponent]].find(n => p.title.endsWith(`for ${n}`));
              expect(card, 'Only the stock summon or activation may ask for a zone or position.').toBeDefined();
              const holder = card === HAND[opponent] ? opponent : actor;
              needPrompt(holder, `Select a ${p.kind === 'places' ? 'zone' : 'position'} for ${card}`);
              if (p.kind === 'places') {
                const location = code === 74271714 && card === name ? 8 : 4;
                expect(p.options.every(o => o.controller === holder && o.location === location)).toBe(true);
                run(zone(SEATS[holder], `${location === 8 ? 's' : 'm'}${p.options[0].sequence!}` as Zone, SEATS[holder]));
              } else run(position(code === 53753697 && holder === actor ? 'def' : 'atk', SEATS[holder]));
            }
            else if (p.kind === 'choice' && p.options.some(o => o.id === 'yes')) {
              const trigger = code === 43632709 && p.title.includes(`Trigger Effect of "${name}"`);
              const holder = trigger || code === 22404570 ? actor : opponent;
              const titles = code === 22404570 ? [
                "Banish (face-down) 3 cards from the top of your opponent's Deck?",
                'Banish (face-down) 1 card your opponent controls?',
                "Banish (face-down) 1 random card from your opponent's hand?",
              ] : trigger ? [`Activate the Trigger Effect of "${name}"`] : code === 74271714 ? ['Banish 2 cards from your hand?'] : ['Special Summon 1 monster from your hand?'];
              expect(titles.some(t => p.title.includes(t)), 'Only a known stock decision may ask yes/no.').toBe(true);
              expect(decisions.has(p.title), 'The stock decision must not repeat.').toBe(false);
              decisions.add(p.title);
              needPrompt(holder, p.title);
              run(trigger || accept ? yes(SEATS[holder]) : no(SEATS[holder]));
            } else if (p.kind === 'cards' || p.kind === 'toggle') {
              if (code === 43632709 && p.title.includes('banish')) {
                needPrompt(actor, 'Select the card(s) to banish');
                run(select({ card: 'Silver Fang', owner: SEATS[actor], from: 'hand' }));
              } else if (code === 43632709 && p.seat === actor) {
                needPrompt(actor, 'Select the card(s) to Special Summon');
                run(select({ card: 'Nimble Momonga', owner: SEATS[actor], from: 'grave' }));
              } else if (code === 22404570 && p.options.some(o => o.card?.name === 'Power Patron DoomZ')) {
                needPrompt(actor, 'Select the card(s) to Special Summon');
                run(select('Power Patron DoomZ'));
              } else if (code === 22404570 || (code === 6325660 && p.title.includes('banish'))) {
                needPrompt(actor, 'Select the card(s) to banish');
                if ([22404570, 6325660].includes(code)) {
                  const targetSeats = [...new Set(p.options.map(o => o.controller))].sort();
                  expect(targetSeats, 'Tag keeps both opposing fields after the hand pick.').toEqual(
                    format === 'tag' ? SEATS.map((_, i) => i).filter(i => i % 2 !== actor % 2) : [opponent]);
                }
                run(select({ card: 'Mystical Elf', owner: SEATS[code === 6325660 ? banishSeat : opponent], from: 'mzone' }));
              } else if (code === 74271714 && p.seat === opponent) {
                needPrompt(opponent, 'Select the card(s) to banish');
                run(select({ card: HAND[opponent], owner: SEATS[opponent] }, { card: 'Dark Hole', owner: SEATS[opponent] }));
              } else if (code === 74271714 && p.options.some(o => o.card?.name === 'Dark Hole' && o.location === 2)) {
                needPrompt(actor, 'Select the card(s) to banish');
                run(select({ card: 'Dark Hole', owner: SEATS[actor], from: 'hand' }));
              } else if (code === 74271714) {
                needPrompt(actor, 'Select the cards to banish or send to the GY');
                run(select({ card: '7 Colored Fish', nth: 0 }, { card: '7 Colored Fish', nth: 0 }));
              } else {
                needPrompt(opponent, 'Select the card(s) to Special Summon');
                run(select({ card: HAND[opponent], owner: SEATS[opponent], from: 'hand' }));
              }
            } else if (code === 74271714 && p.kind === 'choice') {
              needPrompt(actor, 'Select an option');
              run(choose('Send', SEATS[actor]));
            }
            else throw new Error(`Unexpected stock prompt: ${JSON.stringify(p)}`);
          }
          expect(decisions.size, 'All stock decisions must occur once.').toBe(code === 22404570 ? 3 : code === 43632709 ? 2 : 1);
          run(expectBoard(board));
          run(expectPrompt({ by: SEATS[actor], context: 'action' }));
          if (format !== '1v1') {
            expect(picked, 'There must be a live opponent selection.').toBe(1);
            expect(atPick!.some(v => v.events.some(e => e.kind === 'chain-resolving' && e.card?.code === code)),
              'The opponent selection must occur before chain resolution.').toBe(false);
            expect(atPick!.some(v => v.events.some(e => e.kind === 'activate' && e.card?.code === code)),
              'The opponent selection must be part of activation.').toBe(false);
            // Also prove that the own resolution step has not occurred at the pick.
            const state = atPick![actor].seats[actor];
            if (code === 22404570) expect(state.monsters.some(c => c?.name === 'Power Patron DoomZ')).toBe(false);
            if (code === 43632709) expect(state.monsters.some(c => c?.name === 'Nimble Momonga')).toBe(false);
            if (code === 53753697) expect(state.monsters.some(c => c?.code === code)).toBe(false);
            if (code === 6325660) expect(atPick![banishSeat].seats[banishSeat].banished).toHaveLength(0);
          } else expect(picked).toBe(0);
        } finally { game.close(); }
      }, 20000);
    }
  });
}
