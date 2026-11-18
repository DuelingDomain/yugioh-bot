import type { IndexEntry } from './types';

/** The release uses name identity; never match a near spelling or silently take an ambiguous name. */
export const cardNameKey=(name:string)=>name.toLowerCase().replace(/[’']/g,'').replace(/\s+/g,' ').trim();
export function mapBankNames(bank:{id:string;name:string}[],catalog:IndexEntry[]):Map<string,IndexEntry> {
  const byName=new Map<string,IndexEntry|null>();
  for(const entry of catalog) {
    const key=cardNameKey(entry.name),previous=byName.get(key);
    byName.set(key,previous===undefined||previous?.cardId===entry.cardId?entry:null);
  }
  const mapped=new Map<string,IndexEntry>();
  for(const card of bank) {const entry=byName.get(cardNameKey(card.name));if(entry)mapped.set(card.id,entry);}
  return mapped;
}
/** Keep the union. A released bank's own numeric identity remains usable when the other catalog lacks its name. */
export function buildHybridCatalog(catalog:IndexEntry[],bank:IndexEntry[]) {
  const mapping=mapBankNames(bank.map(c=>({id:c.cardId,name:c.name})),catalog);
  for(const card of bank)if(!mapping.has(card.cardId))mapping.set(card.cardId,card);
  return {entries:[...new Map([...catalog,...mapping.values()].map(e=>[e.cardId,e])).values()],bankEntries:Object.fromEntries(mapping)};
}
