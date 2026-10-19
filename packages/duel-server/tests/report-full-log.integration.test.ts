import { defaultDuelSettings } from '@yugidraft/shared/duels';
import { expect, it } from 'vitest';
import { createEngineGame } from '../src/engine.js';
import { createEngineGame as createLegacyGame } from '../src/legacy/engine.js';
import { engineDataDirectory as DATA } from './engine-data-dir.js';

it.each(['pinned', 'legacy'] as const)('%s preserves more than 400 real public events for a private report', async engine => {
  const game = await (engine === 'legacy' ? createLegacyGame : createEngineGame)({ dataDirectory: DATA, mode: 'normal',
    decks: [0, 1].map(() => ({ main: Array(40).fill(69247929), extra: [], side: [] })),
    seed: ['11', '22', '33', '44'], settings: { ...defaultDuelSettings("normal"), startingHand: 0, drawPerTurn: 0, shuffleDeck: false } });
  try {
    for (let turn = 0; turn < 120; turn++) {
      let view = [game.view(0), game.view(1)].find(view => view.prompt);
      expect(view?.prompt, 'A real engine action prompt is required').toBeTruthy();
      const prompt = view!.prompt!;
      const end = prompt.options.find(option => option.id === 'to_ep');
      expect(end).toBeTruthy();
      game.answer(prompt.seat, prompt.id, { choice: end!.id });
    }
    const normal = game.view(null);
    const full = game.view(null, { fullLog: true });
    expect(normal.log).toHaveLength(400);
    expect(full.log.length).toBeGreaterThan(400);
    expect(full.log[0]!.id).toBe(1);
    expect(full.log.slice(-400)).toEqual(normal.log);
    expect(full.log.some(entry => /You drew/.test(entry.text))).toBe(false);
  } finally { game.close(); }
}, 30_000);

it.each(['pinned', 'legacy'] as const)('%s retains at most 10,000 real events and keeps the live view at 400', async engine => {
  const game = await (engine === 'legacy' ? createLegacyGame : createEngineGame)({ dataDirectory: DATA, mode: 'normal',
    decks: [0, 1].map(() => ({ main: Array(40).fill(69247929), extra: [], side: [] })),
    seed: ['11', '22', '33', '44'], settings: { ...defaultDuelSettings('normal'), startingHand: 0, drawPerTurn: 0, shuffleDeck: false } });
  try {
    for (let turn = 0; turn < 3_000; turn++) {
      const view = [game.view(0), game.view(1)].find(view => view.prompt)!;
      const prompt = view.prompt!;
      game.answer(prompt.seat, prompt.id, { choice: 'to_ep' });
    }
    const full = game.view(null, { fullLog: true });
    expect(full.log.at(-1)!.id).toBeGreaterThan(20_000);
    expect(full.log).toHaveLength(10_000);
    expect(full.log[0]!.id).toBe(full.log.at(-1)!.id - 9_999);
    expect(game.view(null).log).toEqual(full.log.slice(-400));
  } finally { game.close(); }
}, 120_000);
