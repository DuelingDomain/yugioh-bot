import Database from 'better-sqlite3';
import { migrate } from '@yugidraft/shared/db';
import { createBugReportService } from '@yugidraft/shared/services';
import { expect, it } from 'vitest';
import { seedIdentity } from './helpers/identity.js';

it('persists the complete public log and private recreate references in the report row', () => {
  const db = new Database(':memory:');
  try {
    migrate(db);
    const actor = seedIdentity(db, { guildId: 'report-storage', userId: 101 });
    const log = Array.from({ length: 700 }, (_, id) => ({ id, text: `Public event ${id}` }));
    const moment = { duelId: 7, journalCount: 32, journalSeq: 40, revision: 29, prefixHash: 'a'.repeat(64), bundleVersion: 'bundle-v1', ruleVersion: 'rule-v1' };
    const deck = { id: 9, mode: 'domain', deck: { main: [1], extra: [], side: [], deckMaster: 2 } };
    const report = createBugReportService(db).create({ guildId: 'report-storage', playerId: actor.playerId,
      path: '/decks/9', description: 'The reported board cannot be restored.', context: {}, diagnostics: { board: null, log, attempts: 1, moment, deck } });
    expect((report.diagnostics as any).log).toEqual(log);
    expect((report.diagnostics as any).moment).toEqual(moment);
    expect((report.diagnostics as any).deck).toEqual(deck);
    expect(report.submitter?.userId).toBe(101);
  } finally { db.close(); }
});
