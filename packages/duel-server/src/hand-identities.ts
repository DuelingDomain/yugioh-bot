/** Animation metadata indexed by engine sequence. Never chooses or sorts the displayed hand. */
type Identity = { id: string; code: number; arrival?: number; public?: boolean };
const isSequence = (sequence: number): boolean => Number.isSafeInteger(sequence) && sequence >= 0;

export class HandIdentities {
  private nextOwn = 0;
  private nextSleeve = 0;
  private own: Identity[][] = [[], []];
  private sleeves: Identity[][] = [[], []];
  /** The last observed sleeve order until a query confirms which effects survived a shuffle. */
  private beforeShuffle: Array<Identity[] | undefined> = [undefined, undefined];
  private shuffledPublic: Array<Map<string, number> | undefined> = [undefined, undefined];
  private mutatedAfterShuffle = [false, false];

  add(seat: number, code: number, sequence: number, arrival?: number, isPublic = false): void {
    if (!this.own[seat] || !isSequence(sequence)) return;
    this.own[seat]!.splice(sequence, 0, { id: `hand-${++this.nextOwn}`, code, arrival });
    const sleeve = { id: `sleeve-${++this.nextSleeve}`, code: isPublic ? code : 0, arrival, public: isPublic };
    const following = this.sleeves[seat]![sequence];
    this.sleeves[seat]!.splice(sequence, 0, sleeve);
    const before = this.beforeShuffle[seat];
    if (before) {
      this.mutatedAfterShuffle[seat] = true;
      const index = following ? before.indexOf(following) : -1;
      before.splice(index < 0 ? before.length : index, 0, sleeve);
    }
  }

  setPublic(seat: number, sequence: number, code: number, isPublic: boolean): void {
    if (!isSequence(sequence)) return;
    const sleeve = this.sleeves[seat]?.[sequence];
    if (!sleeve) return;
    sleeve.public = isPublic;
    sleeve.code = isPublic ? code : 0;
  }

  syncPublic(seat: number, queries: readonly ({ code?: number; isPublic?: boolean } | null)[]): void {
    if (!this.sleeves[seat]) return;
    const before = this.beforeShuffle[seat];
    if (before) {
      // An EFFECT_PUBLIC reset and shuffle can happen between views. Validate the public slots
      // against the new query before publishing IDs, restoring hidden order for expired effects.
      const publicCodes = new Map<number, number>();
      for (const query of queries) {
        if (query?.isPublic && query.code) publicCodes.set(query.code, (publicCodes.get(query.code) ?? 0) + 1);
      }
      const remaining = new Map(publicCodes);
      let expired = false;
      for (const code of this.shuffledPublic[seat]?.values() ?? []) {
        const copies = remaining.get(code) ?? 0;
        if (copies) remaining.set(code, copies - 1);
        else expired = true;
      }
      for (const entry of before) {
        if (!entry.public) continue;
        const copies = publicCodes.get(entry.code) ?? 0;
        if (copies) publicCodes.set(entry.code, copies - 1);
        else {
          entry.public = false;
          entry.code = 0;
          delete entry.arrival;
          // Only this public history is ambiguous after a mutation; hidden sleeves retain
          // their identities and order, including when the public sleeve was already removed.
          if (expired && this.mutatedAfterShuffle[seat]) entry.id = `sleeve-${++this.nextSleeve}`;
        }
      }
      this.sleeves[seat] = this.reorderSleeves(before, queries.map((query) => query?.code ?? 0), queries.map((query) => query?.isPublic === true));
      this.beforeShuffle[seat] = undefined;
      this.shuffledPublic[seat] = undefined;
      this.mutatedAfterShuffle[seat] = false;
    }
    queries.forEach((query, sequence) => {
      if (query?.code) this.setPublic(seat, sequence, query.code, query.isPublic === true);
    });
  }

  remove(seat: number, sequence: number): void {
    if (!this.own[seat] || !isSequence(sequence)) return;
    this.own[seat]!.splice(sequence, 1);
    const sleeve = this.sleeves[seat]!.splice(sequence, 1)[0];
    const before = this.beforeShuffle[seat];
    if (before && sleeve) {
      this.mutatedAfterShuffle[seat] = true;
      const index = before.indexOf(sleeve);
      if (index >= 0) before.splice(index, 1);
    }
  }

  relocate(seat: number, from: number, to: number): void {
    const hand = this.own[seat];
    if (!hand || !isSequence(from) || !isSequence(to) || from >= hand.length || to >= hand.length) return;
    for (const hands of [this.own, this.sleeves]) {
      const entry = hands[seat]!.splice(from, 1)[0];
      if (entry) hands[seat]!.splice(to, 0, entry);
    }
    const before = this.beforeShuffle[seat];
    const entry = this.sleeves[seat]![to]!;
    if (before) {
      this.mutatedAfterShuffle[seat] = true;
      const index = before.indexOf(entry);
      if (index >= 0) before.splice(index, 1);
      const following = this.sleeves[seat]![to + 1];
      const next = following ? before.indexOf(following) : -1;
      before.splice(next < 0 ? before.length : next, 0, entry);
    }
  }

  shuffle(seat: number, codes: readonly number[]): void {
    if (!this.own[seat]) return;
    // SHUFFLE_HAND supplies the new engine sequence. Identical copies are interchangeable.
    const available = [...this.own[seat]!];
    this.own[seat] = codes.map((code) => {
      const index = available.findIndex((entry) => entry.code === code);
      return index >= 0 ? available.splice(index, 1)[0]! : { id: `hand-${++this.nextOwn}`, code };
    });
    this.beforeShuffle[seat] ??= [...this.sleeves[seat]!];
    const publicEntries = this.shuffledPublic[seat] ??= new Map();
    for (const entry of this.sleeves[seat]!) if (entry.public) publicEntries.set(entry.id, entry.code);
    // A concealed shuffle severs the connection to the arrived card. Keeping that old target
    // could later bind its flight to an unrelated card when the slot becomes visible.
    for (const entry of this.sleeves[seat]!) if (!entry.public) delete entry.arrival;
    // Hidden codes cannot choose provisional sleeve slots: a public card may have a hidden
    // duplicate. Keep the prior order until syncPublic receives the actual public slots.
    this.sleeves[seat] = Array.from({ length: codes.length }, (_, sequence) =>
      this.sleeves[seat]![sequence] ?? { id: `sleeve-${++this.nextSleeve}`, code: 0 });
    const before = this.beforeShuffle[seat]!;
    this.beforeShuffle[seat] = before.filter((entry) => this.sleeves[seat]!.includes(entry));
    for (const entry of this.sleeves[seat]!) {
      if (!before.includes(entry)) this.beforeShuffle[seat]!.push(entry);
    }
  }

  private reorderSleeves(entries: readonly Identity[], codes: readonly number[], publicSlots: readonly boolean[]): Identity[] {
    // Only public card positions may follow codes. Fill the gaps with hidden sleeves in their
    // previous order, so neither IDs nor arrival slots disclose a concealed permutation.
    const publicSleeves = entries.filter((entry) => entry.public);
    const hiddenSleeves = entries.filter((entry) => !entry.public);
    const reordered = codes.map((code, sequence) => {
      const index = !publicSlots[sequence] ? -1 : publicSleeves.findIndex((entry) => entry.code === code);
      return index >= 0 ? publicSleeves.splice(index, 1)[0] : undefined;
    });
    // Reconcile the public slot count as well: missing animation messages must not leave stale
    // sleeves or gaps. Owner reconciliation never consumes this audience's ID counter.
    return reordered.map((entry) => entry ?? hiddenSleeves.shift() ?? { id: `sleeve-${++this.nextSleeve}`, code: 0 });
  }

  at(seat: number, owner: boolean, sequence: number): string | undefined {
    return (owner ? this.own : this.sleeves)[seat]?.[sequence]?.id;
  }

  arrival(seat: number, owner: boolean, eventId: number): { id: string; sequence: number } | undefined {
    const hand = (owner ? this.own : this.sleeves)[seat];
    if (!hand) return undefined;
    const sequence = hand.findIndex((entry) => entry.arrival === eventId);
    return sequence < 0 ? undefined : { id: hand[sequence]!.id, sequence };
  }
}
