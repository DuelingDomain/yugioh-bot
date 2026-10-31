import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { aggregate, POLICY, sha, validateArtifact } from './usage.mjs';
const output = resolve(process.argv[2] ?? '.status/format-staples/candidate.json');
const deadline = Date.now() + 600_000;
let lastRequest = 0;
async function fetchBounded(url, maxBytes = 4_000_000) {
  // Sequential pages; every request (including metadata) is at least 1s apart.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, lastRequest + 1000 - Date.now())));
  lastRequest = Date.now();
  if (Date.now() > deadline) throw Error('Refresh timeout');
  const seconds = Math.min(20, (deadline - Date.now()) / 1000);
  return execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '2', '--retry', '2', '--retry-delay', '2', '--retry-max-time', String(seconds), '--max-time', String(seconds), '--max-filesize', String(maxBytes), url], { encoding: 'utf8', timeout: Math.ceil(seconds * 1000) + 1000, maxBuffer: maxBytes });
}
const metadata = new Map();
const cardData = JSON.parse(await fetchBounded('https://db.ygoprodeck.com/api/v7/cardinfo.php', 32_000_000));
for (const card of cardData.data) { metadata.set(card.id, card); for (const image of card.card_images ?? []) metadata.set(image.id, card); }
const tags = new Map(gunzipSync(readFileSync('packages/shared/data/effects/tags.jsonl.gz'), { maxOutputLength: 30_000_000 }).toString().trim().split('\n').map(line => { const r=JSON.parse(line); return [r.id, r.tags]; }));
const generic = id => {
  const card = metadata.get(id), tag = tags.get(id);
  if (!card || !tag || tag.supports?.archetypes?.length || tag.supports?.names?.some(name => name !== card.name)) return false;
  // Membership alone is not a lock (e.g. Ghost Girls). Named requirements are.
  const text = card.desc.replaceAll(`"${card.name}"`, 'SELF');
  return !/"[^"\n]+"\s+(?:monster|card|spell|trap)|(?:control|tribute|discard|send|summon)[^.\n]{0,50}"[^"\n]+"/i.test(text);
};
const categories = { tcg: 'Tournament Meta Decks', domain: 'Domain Format Decks', genesys: 'Genesys Decks' };
const previousPath = 'packages/shared/data/staples/usage.json';
const previous = existsSync(previousPath) ? validateArtifact(JSON.parse(readFileSync(previousPath, 'utf8'))) : null;
const formats = { ...previous?.formats };
const evidencePath = 'packages/shared/data/staples/decks.json';
const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : {};
let refreshed = 0;
for (const [format, category] of Object.entries(categories)) {
  try {
    const decks = [], sources = [];
    for (let offset=0; offset<1000; offset+=20) {
      const url = `https://ygoprodeck.com/api/decks/getDecks.php?limit=20&offset=${offset}&format=${encodeURIComponent(category.toLowerCase())}${format === 'tcg' ? '&tournament' : ''}`;
      const bytes = await fetchBounded(url); const rows = JSON.parse(bytes);
      if (!Array.isArray(rows) || rows.length > 20) throw Error('Invalid deck page');
      sources.push({ url, sha256: sha(bytes) });
      for (const row of rows) {
        if (row.format !== category || !/^[a-z0-9-]+$/i.test(row.pretty_url)) continue;
        if (/\bstaples\b|\bresource\b|\bcollection\b/i.test(row.deck_name)) continue;
        const parts = ['main_deck','extra_deck','side_deck'].map(key => JSON.parse(row[key] || '[]').map(Number));
        if (parts.some((part,i) => !Array.isArray(part) || part.length > (i ? 15 : 60) || part.some(id => !Number.isSafeInteger(id) || id < 1 || !metadata.has(id))) || parts[0].length < (format === 'domain' ? 60 : 40)) continue;
        const archetypes = new Map();
        for (const id of parts[0]) { const card=metadata.get(id); if (card?.archetype && !generic(card.id)) archetypes.set(card.archetype,(archetypes.get(card.archetype)??0)+1); }
        const archetype = [...archetypes].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0]?.[0];
        if (!archetype) continue;
        decks.push({ url: `https://ygoprodeck.com/deck/${row.pretty_url}`, main: parts[0], extra: parts[1], side: parts[2], archetype });
      }
      if (rows.length < 20) break;
    }
    const unique = [...new Map(decks.map(deck => [sha([deck.main,deck.extra,deck.side].map(part => part.map(id => metadata.get(id)?.id ?? id).sort((a,b)=>a-b))), deck])).values()];
    const sample = aggregate(unique, metadata, generic);
    if (sample.deckCount < POLICY.minimumDecks || sample.archetypeCount < 3 || !sample.cards.length) throw Error('Insufficient format data');
    const proposed = { ...sample, sources };
    const check = { schemaVersion: 3, generatedAt: new Date().toISOString(), policy: POLICY, formats: { [format]: proposed } };
    validateArtifact({ ...check, version: sha(check) });
    formats[format] = proposed;
    evidence[format] = unique; refreshed++;
    console.log(`${format}: ${sample.deckCount} decks, ${sample.archetypeCount} archetypes, ${sample.cards.length} staples`);
  } catch (error) { console.error(`${format}: retain prior sample: ${error.message}`); }
}
if (!refreshed) throw Error('No source refreshed');
const identity = { schemaVersion: 3, generatedAt: new Date().toISOString(), policy: POLICY, formats };
const result = validateArtifact({ ...identity, version: sha(identity) });
mkdirSync(resolve(output, '..'), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
writeFileSync(join(resolve(output, '..'), 'decks.json'), JSON.stringify(evidence)+'\n');
