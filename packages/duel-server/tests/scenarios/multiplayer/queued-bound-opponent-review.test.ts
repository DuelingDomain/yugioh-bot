import { afterAll, expect, vi } from 'vitest';
import { createEngineGame } from '../../../src/engine.js';
import { compileBoard } from '../../support/board.js';
import { describeWithCores, needs } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { Session, domainNseatWasmBinary, nseatWasmBinary } from '../../support/session.js';
import { engineDataDirectory } from '../../engine-data-dir.js';
import { domainVariant } from './domain-variants.js';
import { QUEUED_BOUND_REVIEW_CASES, QUEUED_BOUND_REVIEW_SCENARIOS, type BoundReviewCase } from './queued-bound-opponent-review.js';
import type { Scenario } from '../../support/dsl.js';

// Copy only cards.cdb. Unchanged scripts and binaries remain links to the caller's
// data bundle; the four synthetic card scripts exist exclusively in this private directory.
const fixture = await vi.hoisted(async () => {
 const source = process.env.DUEL_DATA_DIR;
 const unused = { directory: '', source, cleanup: () => {} };
 if (process.env.NSEAT_LIVE !== '1') return unused;
 const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = await import('node:fs');
 const { join, resolve } = await import('node:path');
 const { tmpdir } = await import('node:os');
 const { default: Database } = await import('better-sqlite3');
 if (!source || !existsSync(join(source, 'cards.cdb'))) return unused;
 const directory = mkdtempSync(join(tmpdir(), 'queued-bound-review-data-'));
 const cleanup = () => rmSync(directory, { recursive: true, force: true });
 process.once('exit', cleanup);
 try {
  copyFileSync(join(source, 'cards.cdb'), join(directory, 'cards.cdb'));
  for (const name of ['strings.conf', 'domain.lua', 'ocgcore.standard.wasm', 'ocgcore.domain.wasm', 'ocgcore.multi.wasm', 'ocgcore.multi-domain.wasm']) {
   if (existsSync(join(source, name))) symlinkSync(resolve(source, name), join(directory, name));
  }
  const ids = [95200841, 95200842, 95200843, 95200844];
  const names = ['Review Queued Continuous Trap', 'Review Queued Continuous Spell', 'Review Queued Permission Trap', 'Review Queued Both Side'];
  const types = [0x20004, 0x20002, 0x20004, 0x21];
  const scripts = join(directory, 'card-scripts');
  const linkScripts = (from: string, to: string) => {
   mkdirSync(to, { recursive: true });
   for (const entry of readdirSync(from, { withFileTypes: true })) {
    const target = join(to, entry.name);
    if (ids.some(id => target === join(scripts, 'official', `c${id}.lua`))) continue;
    if (entry.isDirectory()) linkScripts(join(from, entry.name), target);
    else symlinkSync(resolve(from, entry.name), target);
   }
  };
  linkScripts(join(source, 'card-scripts'), scripts);
  mkdirSync(join(scripts, 'official'), { recursive: true });
  const db = new Database(join(directory, 'cards.cdb'));
  try {
   const data = db.prepare('INSERT OR REPLACE INTO datas VALUES (?,?,?,?,?,?,?,?,?,?,?)');
   const text = db.prepare(`INSERT OR REPLACE INTO texts VALUES (${Array(19).fill('?').join(',')})`);
   const script = readFileSync(new URL('./fixtures/queued-bound-opponent-review.lua', import.meta.url));
   ids.forEach((id, index) => {
    data.run(id, 3, 0, 0, types[index], index === 3 ? 1000 : 0, 0, index === 3 ? 4 : 0, index === 3 ? 1 : 0, index === 3 ? 1 : 0, 0);
    text.run(id, names[index], 'Private saved-opponent processor fixture.',
     'Review event activation', 'First hand permission', 'Second hand permission', 'First cost choice', 'Second cost choice', ...Array(11).fill(''));
    writeFileSync(join(scripts, 'official', `c${id}.lua`), script);
   });
  } finally { db.close(); }
  process.env.DUEL_DATA_DIR = directory;
  return { directory, source, cleanup };
 } catch (error) {
  cleanup(); process.removeListener('exit', cleanup); throw error;
 }
});
vi.mock('../../engine-data-dir.js', async importOriginal => {
 const actual = await importOriginal<typeof import('../../engine-data-dir.js')>();
 return fixture.directory ? { ...actual, engineDataDirectory: fixture.directory } : actual;
});
afterAll(() => {
 if (fixture.source === undefined) delete process.env.DUEL_DATA_DIR;
 else process.env.DUEL_DATA_DIR = fixture.source;
 fixture.cleanup(); process.removeListener('exit', fixture.cleanup);
});

const domainCases = QUEUED_BOUND_REVIEW_CASES.map(entry => ({ ...entry, scenario: domainVariant(entry.scenario) }));
const cases = [...QUEUED_BOUND_REVIEW_CASES, ...domainCases];
const caseById = new Map(cases.map(entry => [entry.scenario.id, entry]));

function startup(entry: BoundReviewCase): string {
 const both = entry.path === 'both-side';
 const acted = !entry.departed || entry.path === 'cost-prompt';
 const code = both ? 95200844 : entry.path === 'continuous' ? entry.scenario.id.includes('-spell-') ? 95200842 : 95200841 : 95200843;
 const eventPlayer = both && entry.scenario.setup.format === 'tag' ? 3 : 1;
 return `
BoundReview={costs=0,targets=0,operations=0,permissions=0,links=0,disabled=0,cost_prompt=${entry.path === 'cost-prompt'}}
local activation=QueuedReviewEffects[${code}]
assert(activation,'fixture activation missing')
local event=Effect.GlobalEffect()
event:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
event:SetCode(EVENT_SUMMON_SUCCESS)
event:SetOperation(function(e)
 e:Reset()
 Duel.RaiseEvent(activation:GetHandler(),EVENT_CUSTOM+84,e,REASON_EFFECT,${both ? 0 : 1},${eventPlayer},0)
end)
Duel.RegisterEffect(event,0)
local count=Effect.GlobalEffect()
count:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
count:SetCode(EVENT_CHAINING)
count:SetOperation(function(e,tp,eg,ep,ev,re)
 if re==activation then BoundReview.links=BoundReview.links+1 end
end)
Duel.RegisterEffect(count,0)
local disabled=count:Clone()
disabled:SetCode(EVENT_CHAIN_DISABLED)
disabled:SetOperation(function(e,tp,eg,ep,ev,re)
 if re==activation then BoundReview.disabled=BoundReview.disabled+1 end
end)
Duel.RegisterEffect(disabled,0)
local done=count:Clone()
done:SetCode(EVENT_CHAIN_END)
done:SetOperation(function(e)
 assert(BoundReview.links==1,'failed activation must still create exactly one link')
 assert(not activation:CheckCountLimit(${both ? 1 : 0}),'failed activation must consume its count limit')
 assert(BoundReview.disabled==0,'failed causal activation must not raise EVENT_CHAIN_DISABLED')
 assert(BoundReview.costs==${acted ? 1 : 0},'unexpected cost callback count')
 assert(BoundReview.targets==${acted ? 1 : 0},'unexpected target callback count')
 assert(BoundReview.operations==${acted ? 1 : 0},'unexpected operation callback count')
 assert(BoundReview.permissions==${entry.path === 'permission' ? 1 : 0},'unexpected permission count')
 e:Reset()
end)
Duel.RegisterEffect(done,0)
`;
}

async function runPrivate(scenario: Scenario) {
 const entry = caseById.get(scenario.id)!;
 const compiled = compileBoard(scenario.setup);
 const game = await createEngineGame({ ...compiled.options, seed: ['1', '2', '3', '4'], dataDirectory: engineDataDirectory,
  multiWasmBinary: scenario.setup.mode === 'domain' ? domainNseatWasmBinary() : nseatWasmBinary(),
  startupScripts: [...(compiled.options.startupScripts ?? []), { name: 'queued-bound-review-startup.lua', content: startup(entry) }],
 });
 try {
  const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
  scenario.steps.forEach((step, index) => {
   session.run(step, index + 1);
  });
  expect(game.view(0).result).toBeNull();
 } finally { game.close(); }
}

describeWithCores('saved causal opponent processor review', [liveNseat, ...needs.domainMulti()], () => {
 runScenarios('multiplayer/queued-bound-opponent-review', [...QUEUED_BOUND_REVIEW_SCENARIOS, ...domainCases.map(entry => entry.scenario)], runPrivate);
});
