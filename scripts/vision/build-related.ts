/** Offline only. Reuse the effect search's printed names and the engine's IsSetCard rule. */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { quotedNames } from '../../packages/shared/src/cards/effects/bridge-text';
import { compactEffectName } from '../../packages/shared/src/cards/effects/name-match';
import { inArchetype } from '../../packages/shared/src/duels/card-query';
import type { RelatedCards } from '../../packages/vision/src/context-prior';

interface RelationCard { id: number; name: string; text: string; setcodes: number[]; script: string; alias?: number }
const numbers = (text: string) => [...text.matchAll(/\b(?:0x[\da-f]+|\d+)\b/gi)].map(m => Number(m[0]));
export function buildRelatedCards(cards: RelationCard[], setnames: ReadonlyMap<number, string>, constantsText = ''): RelatedCards {
  const data: RelatedCards = { version: 1, names: {}, aliases: {}, links: {}, groups: {}, cardGroups: {} };
  const constants = new Map([...constantsText.matchAll(/\b((?:SET|CARD)_\w+)\s*=\s*(0x[\da-f]+|\d+)/gi)].map(m => [m[1], Number(m[2])]));
  const canonical = new Map(cards.map(c => [c.id, c.alias ?? c.id]));
  const byName = new Map(cards.map(c => [compactEffectName(c.name), c.alias ?? c.id]));
  const bySetName = new Map<string, number[]>();
  for (const [code, name] of setnames) {
    const key = compactEffectName(name);
    bySetName.set(key, [...bySetName.get(key) ?? [], code]);
    const members = [...new Set(cards.filter(c => inArchetype(c.setcodes, code)).map(c => c.alias ?? c.id))].sort((a,b) => a-b);
    if (members.length) data.groups[code] = [name, members];
  }
  for (const card of cards) {
    const id = card.alias ?? card.id;
    if (card.id !== id) data.aliases[card.id] = id;
    data.names[id] ??= card.name;
    const links = new Map<number, 'text' | 'script'>(data.links[id]);
    const groups = new Set(data.cardGroups[id]);
    for (const [code] of setnames) if (inArchetype(card.setcodes, code)) groups.add(code);
    for (const name of quotedNames(card.text)) {
      const key = compactEffectName(name), target = byName.get(key);
      if (target && target !== id) links.set(target, 'text');
      for (const code of bySetName.get(key) ?? []) groups.add(code);
    }
    // Listed names include searches, Summons, Sets and named conditions. IsCode covers
    // older scripts without listed_names. Never interpret arbitrary numeric stats as IDs.
    const script = card.script.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\n]*/g, '');
    const nameBlocks = [...script.matchAll(/(?:listed_names\s*=\s*\{([^}]+)\}|(?:IsCode|CreateToken)\s*\(([^)]*)\)|FilterBoolFunction(?:Ex)?\(Card.IsCode,([^)]*)\))/g)].map(m => m[1] ?? m[2] ?? m[3]);
    const names = nameBlocks.flatMap(block => [...numbers(block), ...(block.match(/\bCARD_\w+\b/g) ?? []).flatMap(token => constants.has(token) ? [constants.get(token)!] : [])]);
    for (const target of names) {
      const resolved = canonical.get(target);
      if (resolved && resolved !== id && !links.has(resolved)) links.set(resolved, 'script');
    }
    // IsSetCard's later arguments are summon/player context, never more setcodes.
    const setBlocks = [...script.matchAll(/listed_series\s*=\s*\{([^}]+)\}/g)].map(m => m[1]);
    for (const pattern of [
      /:IsSetCard\s*\(\s*(\{[^}]*\}|[^,)]*)/g,
      /Card\.IsSetCard\s*\(\s*[^,)]*,\s*(\{[^}]*\}|[^,)]*)/g,
      /FilterBoolFunction(?:Ex)?\s*\(\s*Card\.IsSetCard\s*,\s*(\{[^}]*\}|[^,)]*)/g,
    ]) for (const match of script.matchAll(pattern)) setBlocks.push(match[1]);
    for (const block of setBlocks) {
      for (const code of numbers(block)) if (data.groups[code]) groups.add(code);
      for (const token of block.match(/\bSET_\w+\b/g) ?? []) {
        const code = constants.get(token); if (code && data.groups[code]) groups.add(code);
      }
    }
    if (links.size) data.links[id] = [...links].sort((a,b) => a[0]-b[0]);
    if (groups.size) data.cardGroups[id] = [...groups].sort((a,b) => a-b);
  }
  return data;
}

export async function prepareRelatedCards(engineDir: string, output: string): Promise<void> {
  const { loadCardDatabase } = await import('../../packages/duel-server/src/cards');
  const cards = loadCardDatabase(engineDir);
  try {
    const scripts = new Set(cards.scriptNames?.());
    const data = buildRelatedCards([...cards.all()].map(c => ({ id: c.code, alias: c.canonicalPasscode,
      name: c.name, text: c.description, setcodes: c.setcodes, script: scripts.has(`c${c.code}.lua`) ? cards.readScript(`c${c.code}.lua`) ?? '' : '' })),
      cards.setnames(), `${cards.readScript('archetype_setcode_constants.lua') ?? ''}\n${cards.readScript('card_counter_constants.lua') ?? ''}`);
    const json = JSON.stringify(data) + '\n';
    if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw new Error('Related card artifact exceeds 4 MiB');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(`${output}.part`, json); await rename(`${output}.part`, output);
    console.log(`Related cards: ${Object.keys(data.names).length} cards, ${Buffer.byteLength(json)} bytes -> ${output}`);
  } finally { cards.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '../..');
  await prepareRelatedCards(resolve(process.env.DUEL_DATA_DIR ?? process.env.DUEL_ENGINE_DATA_DIR ?? join(root, 'data/duel-engine')),
    resolve(process.env.VISION_DATA_DIR ?? join(root, 'data/vision'), 'related-cards.json'));
}
