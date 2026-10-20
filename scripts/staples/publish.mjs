import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateArtifact } from './usage.mjs';
const directory = resolve(process.env.STAPLES_OUTPUT ?? '.status/format-staples');
const path = 'packages/shared/data/staples/usage.json', evidence = 'packages/shared/data/staples/decks.json';
const read = file => { const stat=lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size>500_000) throw Error('Invalid artifact file'); return JSON.parse(readFileSync(file,'utf8')); };
const before = validateArtifact(read(path)), candidate = validateArtifact(read(join(directory,'candidate.json')));
for (const format of Object.keys(before.formats)) if (!candidate.formats[format]) throw Error('Cannot drop a format');
const decks = read(join(directory,'decks.json'));
for (const [format, lists] of Object.entries(decks)) {
  if (!candidate.formats[format] || !Array.isArray(lists) || lists.length > 80) throw Error('Invalid evidence format');
  for (const deck of lists) {
    if (Object.keys(deck).sort().join(',') !== 'archetype,extra,main,side,url' || !/^https:\/\/ygoprodeck.com\/deck\/[a-z0-9-]+$/i.test(deck.url) || typeof deck.archetype !== 'string' || deck.archetype.length > 160) throw Error('Invalid evidence provenance');
    for (const section of ['main','extra','side']) if (!Array.isArray(deck[section]) || deck[section].length > (section === 'main' ? 65 : 15) || deck[section].some(id=>!Number.isSafeInteger(id) || id<1 || id>0xffffffff)) throw Error('Invalid source list');
  }
}
const git = (...args) => execFileSync('git',args,{encoding:'utf8'}).trim();
const gh = (...args) => execFileSync('gh',args,{encoding:'utf8'}).trim();
const base = process.env.STAPLES_BASE_SHA;
if (!/^[a-f0-9]{40}$/.test(base??'')) throw Error('Missing trusted base SHA');
if (process.argv.includes('--validate-only')) { console.log('Staple candidate validated'); process.exit(0); }
const repo = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo??'')) throw Error('Invalid repository');
git('fetch','--no-tags','origin','main');
if (git('rev-parse','origin/main') !== base) { console.log('Base advanced; next refresh will retry'); process.exit(0); }
if (git('status','--porcelain','--untracked-files=no')) throw Error('Publish requires a clean checkout');
const branch = `chore/format-staples-${base.slice(0,8)}-${candidate.version.slice(0,8)}`;
if (git('ls-remote','--heads','origin',branch)) { console.log('Artifact branch already exists; leave it intact'); process.exit(0); }
git('switch','--detach',base);
copyFileSync(join(directory,'candidate.json'),path); copyFileSync(join(directory,'decks.json'),evidence);
git('add','--',path,evidence);
git('-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','chore(cards): refresh measured format staples','-m','Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01GLTNwBcU5bVhsdGwaZoeik');
git('push','origin',`HEAD:refs/heads/${branch}`);
const body=join(directory,'pr-body.md');
writeFileSync(body,`Refresh measured usage from bounded YGOPRODeck format samples. Existing formats survive source failures. No code or effect tags change.\n\nArtifact: ${candidate.version}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\nhttps://claude.ai/code/session_01GLTNwBcU5bVhsdGwaZoeik\n`);
gh('pr','create','--repo',repo,'--base','main','--head',branch,'--title','chore(cards): refresh measured format staples','--body-file',body);
gh('workflow','run','test.yml','--repo',repo,'--ref',branch,'-f','nightly=false');
