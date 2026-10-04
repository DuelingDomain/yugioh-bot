import {
 activate, choose, expectEliminated, expectPickOptions, expectPrompt, expectResolved, normalSummon, pass, surrender,
 type DuelistExpect, type Scenario,
} from '../../support/dsl.js';
import { defineScenario } from '../../support/dsl.js';
import { baseSetup, everySeat, SEATS, type Format, type Seat } from './seat-kit.js';

export const REVIEW_TRAP = 95200841;
export const REVIEW_SPELL = 95200842;
export const REVIEW_PERMISSION = 95200843;
export const REVIEW_BOTH_SIDE = 95200844;
export type ReviewPath = 'continuous' | 'permission' | 'cost-prompt' | 'both-side';
export interface BoundReviewCase { scenario: Scenario; path: ReviewPath; departed: boolean; }

function snapshot(format: Format, card: number, path: ReviewPath, departed: boolean): ReturnType<typeof everySeat> {
 const acted = !departed || path === 'cost-prompt';
 const actor: Seat = path === 'both-side' ? 'p1' : 'p0';
 const recipient: Seat = path === 'both-side' ? 'p0' : 'p1';
 const state: Partial<Record<Seat, DuelistExpect>> = {};
 for (const seat of SEATS[format]) {
  state[seat] = { hand: ['Mystical Elf'], deckCount: 20, extra: [] };
 }
 state.p0 = { ...state.p0, monsters: path === 'both-side' ? [card, 'Battle Ox', 'Mystical Elf'] : ['Battle Ox', 'Mystical Elf'],
  spells: path === 'both-side' ? [] : [card],
  zones: path === 'both-side' ? { m0: { card, pos: 'atk', attack: 1000 }, m1: { card: 'Battle Ox', pos: 'atk', attack: 1700 }, m2: { card: 'Mystical Elf', pos: 'atk', attack: 800 } }
   : { m0: { card: 'Battle Ox', pos: 'atk', attack: 2200 }, m1: { card: 'Mystical Elf', pos: 'atk', attack: 1300 }, s0: { card, pos: 'up' } } };
 if (acted) {
  state[actor] = { ...state[actor], lp: (format === 'tag' ? 16000 : 8000) + 23 };
  state[recipient] = { ...state[recipient], lp: (format === 'tag' ? 16000 : 8000) - 777 };
 }
 if (departed) state.p1 = { lp: acted ? 7223 : 8000, hand: [], deckCount: 0, extra: [] };
 return everySeat(format, state);
}

function review(format: Format, path: ReviewPath, card: number, departed: boolean): BoundReviewCase {
 const name = path === 'continuous' ? card === REVIEW_SPELL ? 'spell' : 'trap' : path;
 const scenario = defineScenario({
  id: `queued-review-${format}-${name}-${departed ? path === 'cost-prompt' ? 'deferred-surrender' : 'departed' : 'alive'}`,
  title: path === 'both-side' ? 'The actual activating team replaces a controller-based causal binding'
   : path === 'cost-prompt' ? departed ? 'A surrender in a cost choice preserves the living causal seat until chain end' : 'The saved opponent survives a cost choice and the target runs once'
   : path === 'permission' ? departed ? 'A departed causal seat is checked again after the hand-Trap permission choice' : 'The hand-Trap permission choice keeps the living saved opponent'
   : departed ? 'A failed saved-opponent activation enables its face-up Continuous card effects' : 'A living saved-opponent activation enables its face-up Continuous card effects',
  source: 'docs/adr/0002-multiplayer-duel-rules.md [R-FFA-OPP-RESPONSE] [R-COMMON-SURRENDER-EOT]',
  rules: ['R-FFA-OPP-RESPONSE', 'R-COMMON-SURRENDER-EOT'],
  tags: ['multiplayer', 'synthetic-processor-fixture', 'event-opponent', format, `card:${card}`],
  setup: { ...baseSetup(format, {
   p0: { monsters: path === 'both-side' ? [card, 'Battle Ox'] : ['Battle Ox'],
    hand: ['Mystical Elf', 'Mystical Elf', ...(path === 'permission' ? [card] : [])],
    ...(path === 'permission' || path === 'both-side' ? {} : { spells: [{ card, pos: 'set' }] }) },
   p1: { hand: ['Mystical Elf'] }, p2: { hand: ['Mystical Elf'] },
   ...(format === 'ffa3' ? {} : { p3: { hand: ['Mystical Elf'] } }),
  }), skipOpeningDraw: true },
  steps: [
   normalSummon('Mystical Elf', 'p0'),
   expectPrompt({ by: path === 'both-side' ? 'p1' : 'p0', context: 'chain' }),
   ...(departed && path === 'continuous' ? [surrender('p1')] : []),
   activate(card, path === 'both-side' ? 'p1' : 'p0'),
   // BOTH_SIDE gives p3 its own legal response in Tag. Decline it explicitly so
   // this case proves the p1 activation and its corrected causal binding alone.
   ...(path === 'both-side' && format === 'tag' ? [expectPrompt({ by: 'p3', context: 'chain' }), pass('p3')] : []),
   ...(path === 'permission' ? [expectPrompt({ by: 'p0', kind: 'choice', title: 'Select an option' }),
    expectPickOptions([{ id: 'opt:0', label: 'First hand permission' }, { id: 'opt:1', label: 'Second hand permission' }], 'p0'),
    ...(departed ? [surrender('p1')] : []), choose('opt:0', 'p0')] : []),
   ...(path === 'cost-prompt' ? [expectPrompt({ by: 'p0', kind: 'choice', title: 'Select an option' }),
    expectPickOptions([{ id: 'opt:0', label: 'First cost choice' }, { id: 'opt:1', label: 'Second cost choice' }], 'p0'),
    ...(departed ? [surrender('p1'), expectEliminated()] : []), choose('opt:0', 'p0')] : []),
   // Responders without a legal effect are skipped by the engine.
   expectPrompt({ by: 'p0', title: 'Choose an action' }),
   expectResolved(card),
   expectEliminated(...(departed ? ['p1' as const] : [])),
   snapshot(format, card, path, departed),
  ],
 });
 return { scenario, path, departed };
}

export const QUEUED_BOUND_REVIEW_CASES: BoundReviewCase[] = [
 ...(['ffa3', 'ffa4'] as const).flatMap(format => [
  review(format, 'continuous', REVIEW_TRAP, true), review(format, 'continuous', REVIEW_SPELL, true),
  review(format, 'permission', REVIEW_PERMISSION, true),
  review(format, 'cost-prompt', REVIEW_PERMISSION, true),
  review(format, 'both-side', REVIEW_BOTH_SIDE, false),
 ]),
 // Tag surrender ends the duel. These controls exercise each legal callback path with both teams alive.
 review('tag', 'continuous', REVIEW_TRAP, false), review('tag', 'continuous', REVIEW_SPELL, false),
 review('tag', 'permission', REVIEW_PERMISSION, false), review('tag', 'cost-prompt', REVIEW_PERMISSION, false),
 review('tag', 'both-side', REVIEW_BOTH_SIDE, false),
];

export const QUEUED_BOUND_REVIEW_SCENARIOS = QUEUED_BOUND_REVIEW_CASES.map(entry => entry.scenario);
