export interface EffectFormatFilter {
  format?: "genesys" | "domain";
  region?: "tcg" | "ocg";
  limit?: 0 | 1 | 2 | 3;
  genesysMax?: number;
  copies?: 3;
}
/** Read only explicit format words. The host supplies current admission and point data. */
export function readFormatQuery(input: string): { text: string; filter?: EffectFormatFilter } {
  let text = input; const filter: EffectFormatFilter = {};
  const take = (pattern: RegExp, read: (match: RegExpMatchArray) => void) => {
    text = text.replace(pattern, (...args: unknown[]) => { read(args.slice(0,-2) as RegExpMatchArray); return " "; });
  };
  take(/\b(?:at\s+)?3\s+(?:copies?\s+)?in\s+genesys\b/gi, () => { filter.format="genesys"; filter.copies=3; });
  take(/\bgenesys\s+(?:under|below|less than)\s+(\d{1,3})\s+points?\b/gi, m => { filter.format="genesys"; filter.genesysMax=Math.max(-1,Number(m[1])-1); });
  take(/\b(banned|forbidden|semi[- ]limited|limited|unlimited)\s+in\s+(tcg|ocg)\b/gi, m => {
    filter.region=m[2]!.toLowerCase() as "tcg"|"ocg";
    filter.limit=/banned|forbidden/i.test(m[1]!)?0:/^semi/i.test(m[1]!)?2:/^unlimited$/i.test(m[1]!)?3:1;
  });
  take(/\b(tcg|ocg)\s+only\b/gi, m => { filter.region=m[1]!.toLowerCase() as "tcg"|"ocg"; });
  take(/\b(?:legal\s+in\s+)?genesys(?:\s+legal)?\b/gi, () => { filter.format="genesys"; });
  take(/\b(?:legal\s+in\s+domain|domain\s+legal)\b/gi, () => { filter.format="domain"; });
  take(/^\s*(semi[- ]limited|unlimited|limited)\s*$/gi, m => { filter.limit=/^semi/i.test(m[1]!)?2:/^unlimited$/i.test(m[1]!)?3:1; });
  return { text:text.replace(/\s+/g," ").trim(), ...(Object.keys(filter).length?{filter}:{}) };
}
export function describeFormat(filter?: EffectFormatFilter): string[] {
  if (!filter) return [];
  const chips: string[]=[];
  if (filter.format) chips.push(`Legal in ${filter.format === "genesys"?"Genesys":"Domain"}`);
  if (filter.region) chips.push(`Pool: ${filter.region.toUpperCase()} only`);
  if (filter.limit !== undefined) chips.push(`Limit: ${["banned","limited","semi-limited","unlimited"][filter.limit]}${filter.region?` in ${filter.region.toUpperCase()}`:""}`);
  if (filter.genesysMax !== undefined) chips.push(`Genesys: under ${filter.genesysMax+1} points`);
  if (filter.copies) chips.push("3 copies in Genesys");
  return chips;
}
