import { test, expect } from '../helpers/fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const evidence = process.env.REPORT_EVIDENCE_DIR!;
async function sendReport(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: 'Report bug', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a bug' });
  await dialog.getByLabel(/What went wrong/).fill(`Recreate verification: ${label} shows the wrong card state.`);
  await dialog.getByLabel(/What did you expect/).fill('The same board must load in the saved replay.');
  const response = page.waitForResponse(r => r.url().endsWith('/api/bug-reports') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Send report', exact: true }).click();
  const sent = await response;
  expect(sent.ok(), await sent.text()).toBe(true);
  const result = await sent.json();
  expect(result.issue).toBeNull();
  await expect(dialog.getByRole('status')).toContainText('Saved');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return result.id as number;
}

test('a deck editor report saves the private deck and format without a GitHub issue', async ({ player }) => {
  const owner = await player('p1');
  const created = await owner.page.request.post('/api/decks', { data: {
    name: 'Report recreate deck', mode: 'domain', deck: { main: [68819554], extra: [], side: [], deckMaster: 70903634 },
  } });
  expect(created.ok(), await created.text()).toBe(true);
  const { deck } = await created.json();
  await owner.page.goto(`/decks/${deck.id}`);
  await owner.page.getByRole('button', { name: 'Test hand', exact: true }).click();
  await expect(owner.page.getByRole('region', { name: 'Test hand', exact: true })).toBeVisible();
  await owner.page.screenshot({ path: join(evidence, 'deck-test-hand.png'), fullPage: true });
  const id = await sendReport(owner.page, 'saved deck editor test hand');
  const response = await owner.page.request.get(`/api/admin/bug-reports/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  const report = await response.json();
  if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, 'deck-report.json'), JSON.stringify(report, null, 2)); }
  expect(report.diagnostics.deck).toMatchObject({ id: deck.id, mode: 'domain', deck: deck.deck });
  expect(report.diagnostics.deck.testHand.drawn).toEqual(deck.deck.main);
  expect(report.path).toBe(`/decks/${deck.id}`);
  const download = await owner.page.request.get(`/api/admin/bug-reports/${id}/deck`);
  expect(download.ok()).toBe(true);
  expect(await download.text()).toContain(`#deckmaster\n${deck.deck.deckMaster}`);
  expect(report.submitter).toMatchObject({ userId: 101 });
  expect(report.githubError).toContain('BUG_REPORT_GITHUB_TOKEN is not set');
});

import { startTable, startDuel } from '../helpers/board';
import { withFiller } from '../helpers/decks';
import { decide } from '../helpers/multi';
import { readTable } from '../helpers/table';
import type { DuelAnswer, DuelEngineView } from '@yugidraft/shared/duels';
import type { Seat } from '../helpers/fixtures';
import Database from 'better-sqlite3';
import { dbPath } from '../stack/env.mjs';
import { buildIssueBody } from '../../web/src/lib/bug-report';

function boardState(view: DuelEngineView) {
  return { turn: view.turn, turnSeat: view.turnSeat, phase: view.phase, chain: view.chain,
    seats: view.seats.map(({ hand, extra, ...seat }) => ({ ...seat, handCount: hand.length })) };
}

async function playToXyz(seats: Seat[], slug: string) {
  const actions: unknown[] = [];
  let searched = false, chained = false;
  const summonedTurns = new Set<number>();
  for (let step = 0; step < 130; step++) {
    const rooms = await Promise.all(seats.map(seat => readTable(seat.page, slug)));
    const own = rooms.findIndex(room => room.engine?.prompt != null);
    const publicView = rooms[0].engine!;
    const xyz = publicView.seats[0].monsters.find(card => card?.name === 'Number 39: Utopia');
    if (xyz && xyz.materials?.length === 2 && publicView.turn >= 3 && publicView.chain.length === 0
      && rooms[0].engine?.prompt?.context?.type === 'action') {
      expect(searched).toBe(true); expect(chained).toBe(true);
      expect(summonedTurns.size).toBe(2);
      if (evidence) writeFileSync(join(evidence, `${seats.length}-seat-actions.json`), JSON.stringify(actions, null, 2));
      return;
    }
    expect(own, 'A human seat must own the next real engine prompt').toBeGreaterThanOrEqual(0);
    const view = rooms[own].engine!, prompt = view.prompt!;
    let answer: DuelAnswer | undefined;
    let label = 'default';
    if (prompt.context?.type === 'action' && own === 0) {
      const special = prompt.options.find(o => o.id.startsWith('spsummon:') && o.card?.name === 'Number 39: Utopia');
      const search = !searched && prompt.options.find(o => o.id.startsWith('activate:') && o.card?.name === 'Pot of Greed');
      const summon = !summonedTurns.has(view.turn) && prompt.options.find(o => o.id.startsWith('summon:') && o.card?.name === 'Gene-Warped Warwolf');
      if (special) { answer = { choice: special.id }; label = 'Xyz summon Utopia'; }
      else if (search) { answer = { choice: search.id }; searched = true; label = 'Activate Pot of Greed'; }
      else if (summon) { answer = { choice: summon.id }; summonedTurns.add(view.turn); label = 'Normal Summon Warwolf'; }
    }
    if (!chained && own === 1 && prompt.context?.type !== 'action') {
      const ash = prompt.options.find(o => o.card?.name === 'Ash Blossom & Joyous Spring');
      const yes = prompt.source?.name === 'Ash Blossom & Joyous Spring' ? prompt.options.find(o => o.id === 'yes') : undefined;
      if (ash || yes) { answer = { choice: (ash || yes)!.id }; chained = true; label = 'Chain Ash Blossom'; }
    }
    if (!answer && prompt.kind === 'toggle') {
      const unselected = prompt.options.find(o => !o.selected);
      answer = prompt.finishable ? { finish: true } : unselected ? { choice: unselected.id } : { cancel: true };
    }
    if (!answer) answer = decide(prompt, { wants: [] }).answer as DuelAnswer;
    actions.push({ step, turn: view.turn, seat: own, revision: view.revision, prompt: prompt.title, options: prompt.options, label, answer });
    if (evidence) writeFileSync(join(evidence, `${seats.length}-seat-actions.json`), JSON.stringify(actions, null, 2));
    const result = await seats[own].page.request.post(`/api/duels/${slug}/actions`, { data: { revision: view.revision, promptId: prompt.id, answer } });
    expect(result.ok(), `${label}: ${await result.text()}`).toBe(true);
  }
  throw new Error(`Xyz board was not reached: ${JSON.stringify(actions.slice(-5))}`);
}

for (const format of ['1v1', 'ffa3'] as const) {
  test(`${format} report restores the exact summon, chain and Xyz board through replay and Jump in`, async ({ player }) => {
    test.setTimeout(180_000);
    const alice = await player('p1'), bob = await player('p2');
    const seats = [alice, bob];
    if (format === 'ffa3') seats.push(await player('p3'));
    const domain = format === '1v1';
    const aliceDeck = { main: withFiller(['Pot of Greed', 'Gene-Warped Warwolf', 'Gene-Warped Warwolf']), extra: ['Number 39: Utopia'], ...(domain ? { deckMaster: 'Axe Raider' } : {}) };
    const otherDeck = { main: withFiller(['Ash Blossom & Joyous Spring']), ...(domain ? { deckMaster: 'Axe Raider' } : {}) };
    const options = { ordered: true, looseDecks: true, noBanlist: true, domain, format };
    const { slug } = format === '1v1' ? await startDuel(alice, bob, 'report-domain', aliceDeck, otherDeck, options)
      : await startTable(seats, 'report-multi', [aliceDeck, otherDeck, { main: withFiller([]) }], options);
    await playToXyz(seats, slug);
    await alice.page.screenshot({ path: join(evidence, `${format}-live.png`), fullPage: true });
    const id = await sendReport(alice.page, `${format} Xyz with materials`);
    const data = await alice.page.request.get(`/api/admin/bug-reports/${id}`);
    const report = await data.json();
    writeFileSync(join(evidence, `${format}-report.json`), JSON.stringify(report, null, 2));
    expect(report.diagnostics.moment).toMatchObject({ duelId: expect.any(Number), journalCount: expect.any(Number),
      journalSeq: expect.any(Number), revision: report.diagnostics.board.revision, bundleVersion: expect.any(String), ruleVersion: expect.any(String) });
    expect(report.context).toMatchObject({ format, duelMode: domain ? 'domain' : 'normal', seat: 0, turn: format === '1v1' ? 3 : 4, phase: 'main1' });
    expect(report.diagnostics.log).toEqual(report.diagnostics.board.log);
    expect(report.diagnostics.log.some((entry: { text: string }) => /Ash Blossom/.test(entry.text))).toBe(true);
    expect(report.diagnostics.board.seats[0].monsters.find((card: any) => card?.name === 'Number 39: Utopia').materials).toHaveLength(2);
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('select * from bug_reports where id = ?').get(id) as any;
    db.close();
    expect(JSON.parse(row.diagnostics_json)).toEqual(report.diagnostics);
    const body = buildIssueBody({ reportId: report.publicId, path: report.path, duelSlug: report.duelSlug,
      description: report.description, expected: report.expected, context: report.context });
    writeFileSync(join(evidence, `${format}-public-issue-preview.md`), body);
    for (const privateText of [slug, 'E2E Alice', 'eve@example.test', report.guildId, 'journalCount', report.diagnostics.moment.bundleVersion, 'engineIdentity']) expect(body).not.toContain(privateText);
    for (const endpoint of [`/api/admin/bug-reports/${id}`, `/api/admin/bug-reports/${id}/replay?json=1`, `/settings/bug-reports/${id}`]) {
      const denied = await bob.page.request.get(endpoint);
      expect([403, 404]).toContain(denied.status());
    }
    // Move past the reported moment. The link must still select the old board after the duel ends.
    const current = await readTable(alice.page, slug);
    const end = current.engine!.prompt!.options.find(o => o.id === 'to_ep')!;
    const moved = await alice.page.request.post(`/api/duels/${slug}/actions`, { data: { revision: current.engine!.revision, promptId: current.engine!.prompt!.id, answer: { choice: end.id } } });
    expect(moved.ok(), await moved.text()).toBe(true);
    for (const seat of seats.slice(1)) {
      const surrender = await seat.page.request.post(`/api/duels/${slug}/surrender`);
      expect(surrender.ok(), await surrender.text()).toBe(true);
    }
    await alice.page.goto(`/settings/bug-reports/${id}`);
    await expect(alice.page.getByRole('link', { name: 'Open replay at this moment', exact: true })).toBeVisible();
    await alice.page.screenshot({ path: join(evidence, `${format}-owner-report.png`), fullPage: true });
    const replayLink = await alice.page.request.get(`/api/admin/bug-reports/${id}/replay?json=1`);
    expect(replayLink.ok(), await replayLink.text()).toBe(true);
    const link = await replayLink.json();
    const replayResponse = await alice.page.request.get(`/api/admin/duels/${slug}/replay?version=2&visibility=public`);
    expect(replayResponse.ok(), await replayResponse.text()).toBe(true);
    const replay = await replayResponse.json();
    const frame = replay.frames.find((frame: any) => frame.frameId === link.frameId);
    expect(boardState(frame.view)).toEqual(boardState(report.diagnostics.board));
    await alice.page.getByRole('link', { name: 'Open replay at this moment', exact: true }).click();
    await expect(alice.page).toHaveURL(/frame=/);
    await expect(alice.page.getByRole('button', { name: /Jump in here/ })).toBeEnabled();
    await alice.page.screenshot({ path: join(evidence, `${format}-replay.png`), fullPage: true });
    const forked = alice.page.waitForResponse(r => r.url().endsWith(`/api/admin/duels/${slug}/replay/fork`) && r.request().method() === 'POST');
    await alice.page.getByRole('button', { name: /Jump in here/ }).click();
    const forkResponse = await forked;
    expect(forkResponse.ok(), await forkResponse.text()).toBe(true);
    const fork = await forkResponse.json();
    expect(boardState(fork.room.engine)).toEqual(boardState(report.diagnostics.board));
    writeFileSync(join(evidence, `${format}-recreate.json`), JSON.stringify({ link, frame, fork }, null, 2));
    await expect(alice.page).toHaveURL(new RegExp(`/duels/${fork.slug}`));
    await alice.page.screenshot({ path: join(evidence, `${format}-fork.png`), fullPage: true });
    await alice.page.request.post(`/api/duels/${fork.slug}/fork/cancel`);
    if (format === '1v1') {
      // Keep the real server cursors and real fork route. Supply the server's size-limit response shape to the browser.
      await alice.page.route(`**/api/admin/duels/${slug}/replay?*`, async route => {
        const response = await route.fetch();
        const raw = await response.json();
        const frames = raw.frames;
        await route.fulfill({ response, json: { ...raw, frames: [frames.at(-1)],
          forkSteps: frames.map(({ view, ...step }: any) => step),
          replayError: { code: 'REPLAY_TOO_LARGE', error: 'Move views exceed the size limit.' } } });
      });
      await alice.page.goto(link.href);
      await expect(alice.page.getByRole('combobox', { name: 'Jump in at move' })).toHaveValue(frame.frameId);
      // The preview controller must not replace the requested moment in the URL.
      await expect.poll(() => new URL(alice.page.url()).searchParams.get('frame')).toBe(frame.frameId);
      const oversizedForked = alice.page.waitForResponse(r => r.url().endsWith(`/api/admin/duels/${slug}/replay/fork`) && r.request().method() === 'POST');
      await alice.page.getByRole('button', { name: /Jump in here/ }).click();
      const oversizedResponse = await oversizedForked;
      expect(oversizedResponse.ok(), await oversizedResponse.text()).toBe(true);
      const oversized = await oversizedResponse.json();
      writeFileSync(join(evidence, 'oversized-recreate.json'), JSON.stringify(oversized, null, 2));
      expect(boardState(oversized.room.engine)).toEqual(boardState(report.diagnostics.board));
      await alice.page.request.post(`/api/duels/${oversized.slug}/fork/cancel`);
      await alice.page.unroute(`**/api/admin/duels/${slug}/replay?*`);
    }


    if (format === '1v1') {
      // The real room store records the source visit, but a fork must not replace it.
      await alice.page.goto('/decks');
      await alice.page.getByRole('button', { name: 'Report bug', exact: true }).click();
      const dialog = alice.page.getByRole('dialog', { name: 'Report a bug' });
      await expect(dialog.getByRole('checkbox', { name: 'Attach my last duel' })).toBeChecked();
      await alice.page.screenshot({ path: join(evidence, 'attach-last-duel.png'), fullPage: true });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      const attached = await sendReport(alice.page, 'deck library after a duel');
      const recent = await (await alice.page.request.get(`/api/admin/bug-reports/${attached}`)).json();
      expect(recent.path).toBe('/decks'); expect(recent.duelSlug).toBe(slug);
      expect(recent.diagnostics.moment.duelId).toBe(report.diagnostics.moment.duelId);
      const completedLink = await alice.page.request.get(`/api/admin/bug-reports/${attached}/replay?json=1`);
      expect(completedLink.ok(), await completedLink.text()).toBe(true);
      const completedFrame = (await completedLink.json()).frameId;
      const completedReplay = await (await alice.page.request.get(`/api/admin/duels/${slug}/replay?version=2&visibility=public`)).json();
      expect(completedReplay.frames.find((entry: any) => entry.frameId === completedFrame).kind).toBe('result');

      await alice.page.getByRole('button', { name: 'Report bug', exact: true }).click();
      await dialog.getByRole('checkbox', { name: 'Attach my last duel' }).uncheck();
      await dialog.getByLabel(/What went wrong/).fill('This deck library report has no duel attached.');
      await dialog.getByLabel(/What did you expect/).fill('Only the current page must be saved.');
      const sent = alice.page.waitForResponse(r => r.url().endsWith('/api/bug-reports') && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Send report', exact: true }).click();
      const detachedId = (await (await sent).json()).id;
      const detached = await (await alice.page.request.get(`/api/admin/bug-reports/${detachedId}`)).json();
      expect(detached.duelSlug).toBeNull(); expect(detached.diagnostics.moment).toBeUndefined();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await alice.page.evaluate(() => sessionStorage.setItem('bug-report-last-duel', JSON.stringify({ slug: 'expired', at: Date.now() - 601_000 })));
      await alice.page.getByRole('button', { name: 'Report bug', exact: true }).click();
      await expect(dialog.getByRole('checkbox', { name: 'Attach my last duel' })).toHaveCount(0);
      writeFileSync(join(evidence, 'outside-duel-reports.json'), JSON.stringify({ recent, detached }, null, 2));
    }
  });
}

test('a report from a real long duel saves the complete public log', async ({ player }) => {
  test.setTimeout(180_000);
  const a = await player('p4'), b = await player('p5'), owner = await player('p1');
  const deck = { main: withFiller([], 40) };
  const { slug } = await startDuel(a, b, 'report-full-log', deck, deck, { ordered: true, looseDecks: true, noBanlist: true, startingHand: 0, drawPerTurn: 0 });
  for (let step = 0; step < 400; step++) {
    const rooms = await Promise.all([readTable(a.page, slug), readTable(b.page, slug)]);
    if (rooms[0].engine!.turn >= 121) break;
    const index = rooms.findIndex(room => room.engine?.prompt);
    const view = rooms[index].engine!, prompt = view.prompt!;
    const result = await [a, b][index].page.request.post(`/api/duels/${slug}/actions`, {
      data: { revision: view.revision, promptId: prompt.id, answer: decide(prompt, { wants: [] }).answer },
    });
    expect(result.ok(), await result.text()).toBe(true);
  }
  expect((await readTable(a.page, slug)).engine!.turn).toBeGreaterThanOrEqual(121);
  const id = await sendReport(a.page, 'complete public log after 120 turns');
  const report = await (await owner.page.request.get(`/api/admin/bug-reports/${id}`)).json();
  expect(report.diagnostics.log.length).toBeGreaterThan(400);
  expect(report.diagnostics.log[0].id).toBe(1);
  expect(report.diagnostics.log.some((entry: { text: string }) => /You drew/.test(entry.text))).toBe(false);
  writeFileSync(join(evidence, 'long-duel-report.json'), JSON.stringify(report, null, 2));
  await b.page.request.post(`/api/duels/${slug}/surrender`);
});
