import Database from 'better-sqlite3';
import { migrate } from '@yugidraft/shared/db';
import { createBugReportService } from '@yugidraft/shared/services';
import { expect, it } from 'vitest';
import { seedIdentity } from './helpers/identity.js';

it('persists the complete public log and private recreate references in the report row', () => {
  const db = new Database(':memory:');
  try {
    migrate(db);
    const actor = seedIdentity(db, { guildId: 'report-storage', userId: "101" });
    const log = Array.from({ length: 845 }, (_, id) => ({ id, text: `Public event ${id}` }));
    const moment = { duelId: 7, journalCount: 32, journalSeq: 40, revision: 29, prefixHash: 'a'.repeat(64), bundleVersion: 'bundle-v1', ruleVersion: 'rule-v1' };
    const deck = { id: 9, mode: 'domain', deck: { main: [1], extra: [], side: [], deckMaster: 2 } };
    const report = createBugReportService(db).create({ guildId: 'report-storage', playerId: actor.playerId,
      path: '/decks/9', description: 'The reported board cannot be restored.', context: {}, diagnostics: { board: null, log, attempts: 1, moment, deck } });
    expect((report.diagnostics as any).log).toEqual(log);
    expect((report.diagnostics as any).moment).toEqual(moment);
    expect((report.diagnostics as any).deck).toEqual(deck);
    expect(report.submitter?.userId).toBe("101");
  } finally { db.close(); }
});

for (const [label, count, text] of [
  ['entry count', 20_000, 'Public event'],
  ['UTF-8 bytes', 9_000, '公開😀'.repeat(100)],
  ['one oversized entry', 1, '公開😀'.repeat(300_000)],
] as const) {
  it(`bounds the stored report log by ${label} and keeps its newest entries`, () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      const actor = seedIdentity(db, { guildId: 'bounded-report', userId: '101' });
      const log = Array.from({ length: count }, (_, id) => ({ id, text: `${text} ${id}` }));
      const report = createBugReportService(db).create({ guildId: 'bounded-report', playerId: actor.playerId,
        path: '/duels/test', description: 'The duel log exceeds the storage limit.', context: {},
        diagnostics: { board: null, log, attempts: 1 } });
      const stored = db.prepare('select diagnostics_json from bug_reports where id = ?').get(report.id) as { diagnostics_json: string };
      const diagnostics = JSON.parse(stored.diagnostics_json);
      expect(diagnostics.logTruncated).toBe(true);
      expect(diagnostics.logTotal).toBe(count);
      expect(diagnostics.log.length).toBeLessThanOrEqual(10_000);
      expect(Buffer.byteLength(JSON.stringify(diagnostics.log))).toBeLessThanOrEqual(2 * 1024 * 1024);
      if (count === 1) {
        expect(diagnostics.log[0].text).toContain(' 0');
        expect(diagnostics.log[0].truncated).toBe(true);
      } else {
        expect(diagnostics.log.at(-1)).toEqual(log.at(-1));
        expect(diagnostics.log).toEqual(log.slice(-diagnostics.log.length));
      }
      if (label === 'entry count') {
        expect(diagnostics.log).toHaveLength(10_000);
        expect(Buffer.byteLength(stored.diagnostics_json)).toBeLessThan(2 * 1024 * 1024);
      }
    } finally { db.close(); }
  });
}
