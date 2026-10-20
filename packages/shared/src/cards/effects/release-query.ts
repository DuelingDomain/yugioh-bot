import type { ReleasedRange } from "./releases.js";

/** Calendar-year conventions for search, independent of format legality or TV broadcast regions. */
export const RELEASE_ERAS = {
  DM: [1999, 2003], GX: [2004, 2007], "5D's": [2008, 2010], ZEXAL: [2011, 2013],
  "ARC-V": [2014, 2016], VRAINS: [2017, 2019], SEVENS: [2020, 2021], "GO RUSH": [2022, 2025],
} as const;
export function describeReleased(range: ReleasedRange): string {
  const region = range.region ? ` (${range.region.toUpperCase()})` : "";
  return `Released: ${range.from && range.to ? `${range.from} to ${range.to}` : range.from ? `since ${range.from}` : range.to ? `through ${range.to}` : "any date"}${region}`;
}
/** Remove time phrases before the effect reader can treat them as text or effect verbs. */
export function readReleaseQuery(input: string, now = new Date()): { text: string; released?: ReleasedRange; releaseLabel?: string; sort?: "newest" } {
  let text = input;
  let released: ReleasedRange | undefined, label: string | undefined, sort: "newest" | undefined;
  const yearValid = (year: number) => year >= 1999 && year <= now.getUTCFullYear() + 1;
  const consume = (pattern: RegExp, read: (match: RegExpMatchArray) => { range?: ReleasedRange; label?: string; sort?: "newest" } | undefined) => {
    text = text.replace(pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2) as RegExpMatchArray;
      const result = read(match);
      if (!result) return String(match[0]);
      if (result.range) {
        released = { ...released, ...result.range,
          ...(released?.from && result.range.from ? { from: released.from > result.range.from ? released.from : result.range.from } : {}),
          ...(released?.to && result.range.to ? { to: released.to < result.range.to ? released.to : result.range.to } : {}) };
        label = label ? `${label}; ${result.label}` : result.label;
      }
      if (result.sort) sort = result.sort;
      return " ";
    });
  };
  consume(/\b(?:released\s+)?(?:(?:from|between)\s+)?(\d{4})\s*(?:[-–]|to|and)\s*(\d{4})\b/gi, m => {
    const a = Number(m[1]), b = Number(m[2]);
    if ((!/\bbetween\b/i.test(m[0]) && /\band\b/i.test(m[0])) || !yearValid(a) || !yearValid(b) || a > b) return undefined;
    return { range: { from: `${a}-01`, to: `${b}-12` }, label: `${a}-${b}` };
  });
  consume(/\b(dm|gx|5d['’]?s|zexal|arc[- ]v|vrains|sevens|go rush!*)\s+era\b/gi, m => {
    const key = m[1]!.toUpperCase().replace(/[!'’]/g, "").replace("ARC V", "ARC-V");
    const name = key === "5DS" ? "5D's" : key as keyof typeof RELEASE_ERAS;
    const [from, to] = RELEASE_ERAS[name];
    return { range: { from: `${from}-01`, to: `${to}-12` }, label: `${name} era (${from}-${to})` };
  });
  consume(/\b(?:released\s+)?(before|pre-|older than|after|since|in|from)\s*(\d{4})(?:\s+on)?\b/gi, m => {
    const year = Number(m[2]);
    if (!yearValid(year)) return undefined;
    const before = /^(before|pre-|older than)$/i.test(m[1]!);
    const single = m[1]!.toLowerCase() === "in";
    return { range: before ? { to: `${year - 1}-12` } : single ? { from: `${year}-01`, to: `${year}-12` } : { from: `${year}-01` }, label: `${before ? "before" : single ? "in" : m[1]!.toLowerCase()} ${year}` };
  });
  consume(/\breleased\s+(\d{4})\b/gi, m => {
    const year=Number(m[1]); return yearValid(year)?{range:{from:`${year}-01`,to:`${year}-12`},label:`in ${year}`}:undefined;
  });
  const recent = (months: number) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
    return { from: date.toISOString().slice(0, 7), to: now.toISOString().slice(0, 7) };
  };
  consume(/\b(?:last\s+(\d{1,2})\s+months?|new cards)\b/gi, m => {
    const months = m[1] ? Number(m[1]) : 3;
    return months >= 1 && months <= 60 ? { range: recent(months), label: `last ${months} months`, ...(m[1] ? {} : { sort: "newest" as const }) } : undefined;
  });
  consume(/\bnewest(?:\s+first)?\b/gi, () => ({ sort: "newest" }));
  if (released || sort) text = text.replace(/\b(tcg|ocg)\b/i, region => {
    released = { ...released, region: region.toLowerCase() as "tcg" | "ocg" };
    label ??= "any date";
    return " ";
  });
  return { text: text.replace(/\s+/g, " ").trim(), ...(released ? { released, releaseLabel: `Released: ${label}${released.region ? ` (${released.region.toUpperCase()})` : ""}` } : {}), ...(sort ? { sort } : {}) };
}
