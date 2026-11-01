import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateArtifact } from './usage.mjs';
const directory = resolve(process.env.STAPLES_OUTPUT ?? '.status/format-staples');
const path = 'packages/shared/data/staples/usage.json', observations = 'packages/shared/data/staples/bridge-observations.json';
const read = (file,maxBytes=2_000_000) => { const stat=lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size>maxBytes) throw Error('Invalid artifact file'); return JSON.parse(readFileSync(file,'utf8')); };
const before = validateArtifact(read(path)), candidate = validateArtifact(read(join(directory,'candidate.json')));
for (const format of Object.keys(before.formats)) if (!candidate.formats[format]) throw Error('Cannot drop a format');
const decks = read(join(directory,'decks.json'),8_000_000);
for (const [format, lists] of Object.entries(decks)) {
  if (!candidate.formats[format] || !Array.isArray(lists) || lists.length > 1000) throw Error('Invalid evidence format');
  for (const deck of lists) {
    if (Object.keys(deck).sort().join(',') !== 'archetype,extra,main,side,url' || !/^https:\/\/ygoprodeck.com\/deck\/[a-z0-9-]+$/i.test(deck.url) || typeof deck.archetype !== 'string' || deck.archetype.length > 160) throw Error('Invalid evidence provenance');
    for (const section of ['main','extra','side']) if (!Array.isArray(deck[section]) || deck[section].length > (section === 'main' ? 65 : 15) || deck[section].some(id=>!Number.isSafeInteger(id) || id<1 || id>0xffffffff)) throw Error('Invalid source list');
  }
}
execFileSync(process.execPath,['--conditions=source','--import','tsx','scripts/staples/bridge-observations.ts',join(directory,'decks.json'),join(directory,'candidate.json'),join(directory,'bridge-observations.json')],{stdio:'inherit'});
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
copyFileSync(join(directory,'candidate.json'),path); copyFileSync(join(directory,'bridge-observations.json'),observations);
git('add','--',path,observations);
git('-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','chore(cards): refresh measured format usage and bridge observations');
git('push','origin',`HEAD:refs/heads/${branch}`);
const body=join(directory,'pr-body.md');
writeFileSync(body,`Refresh measured usage and derived bridge pair/core statistics from bounded YGOPRODeck format samples. Existing formats survive source failures. Raw deck lists are retained only in the job artifact.\n\nArtifact: ${candidate.version}\n`);
gh('pr','create','--repo',repo,'--base','main','--head',branch,'--title','chore(cards): refresh measured format staples','--body-file',body);
// A push with the PR token starts the PR checks; GITHUB_TOKEN pushes do not.
if(process.env.HAS_PR_TOKEN!=='true') gh('workflow','run','test.yml','--repo',repo,'--ref',branch,'-f','nightly=false');
