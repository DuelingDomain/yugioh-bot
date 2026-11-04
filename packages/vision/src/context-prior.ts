import type { RecognitionPriors } from './types';

/** Engine passcodes; archetype membership is stored once instead of as all card pairs. */
export interface RelatedCards {
  version: 1;
  names: Record<string, string>;
  aliases: Record<string, number>;
  links: Record<string, [target: number, source: 'text' | 'script'][] >;
  groups: Record<string, [name: string, members: number[]]>;
  cardGroups: Record<string, number[]>;
}

/** Only the supplied player's current/recent public cards seed the prior. */
export function relatedPriors(data: RelatedCards, context: readonly number[]): NonNullable<RecognitionPriors['related']> {
  const result = new Map<string, string>();
  const sources = [...new Set(context.map(id => data.aliases[id] ?? id))].slice(0, 64);
  for (const source of sources) {
    const name = data.names[source];
    if (!name) continue;
    for (const [target, kind] of data.links[source] ?? []) {
      const id = String(target);
      if (!result.has(id)) result.set(id, kind === 'text' ? `mentioned by ${name}` : `script link from ${name}`);
    }
  }
  for (const source of sources) for (const code of data.cardGroups[source] ?? []) {
    const group = data.groups[code];
    if (!group) continue;
    for (const target of group[1]) {
      const id = String(target);
      if (!result.has(id)) result.set(id, group[1].includes(source) ? `${group[0]} archetype from ${data.names[source]}`
        : `mentioned by ${data.names[source]} (${group[0]} archetype)`);
    }
  }
  return [...result].map(([cardId, reason]) => ({ cardId, reason }));
}

/** A scoped, bounded hint; callers use a room/game/seat key. Never retained in prepared options. */
export class VoicePrior {
  private hints = new Map<string, { cardId: number; at: number; until: number }>();
  mention(scope: string, cardId: number, at = Date.now(), now = at): void {
    for (const [key, hint] of this.hints) if (hint.until <= now) this.hints.delete(key);
    if (!Number.isFinite(at) || at + 10_000 <= now || (this.hints.get(scope)?.at ?? -Infinity) > at) return;
    if (Number.isSafeInteger(cardId) && cardId > 0) this.hints.set(scope, { cardId, at, until: at + 10_000 });
    if (this.hints.size > 16) this.hints.delete(this.hints.keys().next().value!);
  }
  current(scope: string, now = Date.now()): number[] {
    const hint = this.hints.get(scope);
    if (!hint || hint.until <= now) { this.hints.delete(scope); return []; }
    return [hint.cardId];
  }
  expiresAt(scope: string): number | undefined { return this.hints.get(scope)?.until; }
}
