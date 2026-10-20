import { createHash } from 'node:crypto';
export const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const FORMATS = ['tcg', 'domain', 'genesys', 'genesys-domain'];
export const POLICY = { minimumDecks: 20, minimumShare: 0.1, minimumArchetypes: 3, maximumArchetypeShare: 0.6 };
export function aggregate(decks, metadata, generic) {
  const unique = new Map();
  for (const deck of decks) {
    const key = sha([...deck.main, ...deck.extra, ...deck.side].map(code => metadata.get(code)?.id ?? code).sort((a,b) => a-b));
    if (!unique.has(key)) unique.set(key, deck);
  }
  decks = [...unique.values()];
  const counts = new Map();
  for (const deck of decks) {
    const copies = new Map();
    for (const code of [...deck.main, ...deck.extra, ...deck.side]) {
      const id = metadata.get(code)?.id ?? code;
      copies.set(id, (copies.get(id) ?? 0) + 1);
    }
    for (const [id, n] of copies) {
      const row = counts.get(id) ?? { passcode: id, name: metadata.get(id)?.name ?? String(id), decks: 0, copies: 0, archetypes: {} };
      row.decks++; row.copies += n; row.archetypes[deck.archetype] = (row.archetypes[deck.archetype] ?? 0) + 1; counts.set(id, row);
    }
  }
  const cards = decks.length < POLICY.minimumDecks ? [] : [...counts.values()].filter(row => generic(row.passcode)
    && row.decks / decks.length >= POLICY.minimumShare && Object.keys(row.archetypes).length >= POLICY.minimumArchetypes
    && Math.max(...Object.values(row.archetypes)) / row.decks <= POLICY.maximumArchetypeShare)
    .map(row => ({ ...row, playShare: row.decks / decks.length, averageCopies: row.copies / row.decks }))
    .sort((a,b) => b.playShare-a.playShare || b.averageCopies-a.averageCopies || a.passcode-b.passcode).slice(0,80);
  const archetypeDeckCounts = {};
  for (const deck of decks) archetypeDeckCounts[deck.archetype]=(archetypeDeckCounts[deck.archetype]??0)+1;
  const archetypeUsage=Object.fromEntries(Object.keys(archetypeDeckCounts).map(name=>[name,[...counts.values()].filter(row=>row.archetypes[name] && generic(row.passcode))
    .sort((a,b)=>b.archetypes[name]-a.archetypes[name] || a.passcode-b.passcode).slice(0,40).map(row=>({passcode:row.passcode,decks:row.archetypes[name]}))]));
  const genericUsage=[...counts.values()].filter(row=>generic(row.passcode)).sort((a,b)=>a.passcode-b.passcode).map(row=>({passcode:row.passcode,decks:row.decks}));
  return { genericUsage, deckCount: decks.length, archetypeCount: new Set(decks.map(d => d.archetype)).size, cards, archetypeDeckCounts, archetypeUsage };
}
export function validateArtifact(data) {
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected.split(',').sort().join(',');
  if (!keys(data,'schemaVersion,generatedAt,policy,formats,version') || !keys(data.policy,'minimumDecks,minimumShare,minimumArchetypes,maximumArchetypeShare')
    || !data.formats || typeof data.formats !== 'object' || Array.isArray(data.formats) || !Number.isFinite(Date.parse(data.generatedAt)) || new Date(data.generatedAt).toISOString() !== data.generatedAt) throw Error('Invalid staple schema/date');
  if (data.schemaVersion !== 3 || !/^\d{4}-\d{2}-\d{2}T/.test(data.generatedAt) || JSON.stringify(data.policy) !== JSON.stringify(POLICY)) throw Error('Invalid staple schema/policy');
  const { version, ...identity } = data;
  if (sha(identity) !== version || Object.keys(data.formats).some(key => !FORMATS.includes(key))) throw Error('Invalid staple version/formats');
  for (const sample of Object.values(data.formats)) {
    if (!keys(sample,'deckCount,archetypeCount,cards,genericUsage,archetypeDeckCounts,archetypeUsage,sources') || !Array.isArray(sample.cards) || !Number.isInteger(sample.deckCount) || sample.deckCount < POLICY.minimumDecks || !Number.isInteger(sample.archetypeCount) || sample.archetypeCount < 3 || sample.cards.length > 80 || !Array.isArray(sample.sources) || !sample.sources.length || sample.sources.length > 5) throw Error('Invalid staple sample');
    for (const source of sample.sources) if (!keys(source,'url,sha256') || !/^https:\/\/ygoprodeck.com\//.test(source.url) || !/^[a-f0-9]{64}$/.test(source.sha256)) throw Error('Invalid staple source');
    if (!sample.archetypeDeckCounts || !sample.archetypeUsage || Object.keys(sample.archetypeDeckCounts).length!==sample.archetypeCount
      || Object.keys(sample.archetypeUsage).length!==sample.archetypeCount || Object.values(sample.archetypeDeckCounts).some(n=>!Number.isInteger(n)||n<1)
      || Object.values(sample.archetypeDeckCounts).reduce((a,b)=>a+b,0)!==sample.deckCount) throw Error('Invalid archetype denominators');
    for(const [name,rows] of Object.entries(sample.archetypeUsage)) {
      if(!sample.archetypeDeckCounts[name] || !Array.isArray(rows) || rows.length>40 || new Set(rows.map(row=>row.passcode)).size!==rows.length) throw Error('Invalid archetype usage');
      for(const row of rows) if(!keys(row,'passcode,decks') || !Number.isSafeInteger(row.passcode) || row.passcode<1 || row.passcode>0xffffffff || !Number.isInteger(row.decks) || row.decks<1 || row.decks>sample.archetypeDeckCounts[name]) throw Error('Invalid archetype card');
    }
    if(!Array.isArray(sample.genericUsage) || sample.genericUsage.length>7200) throw Error('Invalid generic usage');
    const genericCounts=new Map();
    for(const row of sample.genericUsage) {
      if(!keys(row,'passcode,decks') || !Number.isSafeInteger(row.passcode) || row.passcode<1 || row.passcode>0xffffffff || genericCounts.has(row.passcode)
        || !Number.isInteger(row.decks) || row.decks<1 || row.decks>sample.deckCount) throw Error('Invalid generic card count');
      genericCounts.set(row.passcode,row.decks);
    }
    const archetypeTotals=new Map();
    for(const rows of Object.values(sample.archetypeUsage)) for(const row of rows) archetypeTotals.set(row.passcode,(archetypeTotals.get(row.passcode)??0)+row.decks);
    if([...archetypeTotals].some(([id,n])=>!genericCounts.has(id) || n>genericCounts.get(id))) throw Error('Generic count below archetype count');
    const ids = new Set();
    for (const row of sample.cards) {
      if (genericCounts.get(row.passcode)!==row.decks || !keys(row,'passcode,name,decks,copies,archetypes,playShare,averageCopies') || !row.archetypes || typeof row.archetypes !== 'object' || Array.isArray(row.archetypes) || !Number.isSafeInteger(row.passcode) || row.passcode < 1 || row.passcode > 0xffffffff || ids.has(row.passcode) || typeof row.name !== 'string' || row.name.length > 160
        || !Number.isInteger(row.decks) || row.decks < 1 || row.decks > sample.deckCount || !Number.isInteger(row.copies) || row.copies < row.decks || row.copies > row.decks * 3
        || row.playShare !== row.decks/sample.deckCount || row.playShare < POLICY.minimumShare || row.averageCopies !== row.copies/row.decks
        || Object.keys(row.archetypes).length < 3 || Object.values(row.archetypes).some(n => !Number.isInteger(n) || n < 1)
        || Object.values(row.archetypes).reduce((a,b)=>a+b,0) !== row.decks || Math.max(...Object.values(row.archetypes))/row.decks > POLICY.maximumArchetypeShare) throw Error('Invalid staple card');
      ids.add(row.passcode);
    }
  }
  return data;
}
