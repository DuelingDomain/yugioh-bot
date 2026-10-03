/** Animation metadata indexed by engine sequence. Never chooses or sorts the displayed hand. */
type Identity = { id: string; code: number; arrival?: number };

export class HandIdentities {
  private next = 0;
  private own: Identity[][] = [[], []];
  private sleeves: Identity[][] = [[], []];

  add(seat: number, code: number, sequence: number, arrival?: number): void {
    const id = ++this.next;
    this.own[seat]!.splice(sequence, 0, { id: `hand-${id}`, code, arrival });
    this.sleeves[seat]!.splice(sequence, 0, { id: `sleeve-${id}`, code: 0, arrival });
  }

  remove(seat: number, sequence: number): void {
    this.own[seat]!.splice(sequence, 1);
    this.sleeves[seat]!.splice(sequence, 1);
  }

  relocate(seat: number, from: number, to: number): void {
    for (const hands of [this.own, this.sleeves]) {
      const entry = hands[seat]!.splice(from, 1)[0];
      if (entry) hands[seat]!.splice(to, 0, entry);
    }
  }

  shuffle(seat: number, codes: readonly number[]): void {
    // SHUFFLE_HAND supplies the new engine sequence. Identical copies are interchangeable.
    const available = [...this.own[seat]!];
    this.own[seat] = codes.map((code) => {
      const index = available.findIndex((entry) => entry.code === code);
      return index >= 0 ? available.splice(index, 1)[0]! : { id: `hand-${++this.next}`, code };
    });
    // Hidden permutations are private. Sleeves stay bound to public engine slots, never card codes.
  }

  at(seat: number, owner: boolean, sequence: number): string | undefined {
    return (owner ? this.own : this.sleeves)[seat]?.[sequence]?.id;
  }

  arrival(seat: number, owner: boolean, eventId: number): { id: string; sequence: number } | undefined {
    const hand = (owner ? this.own : this.sleeves)[seat]!;
    const sequence = hand.findIndex((entry) => entry.arrival === eventId);
    return sequence < 0 ? undefined : { id: hand[sequence]!.id, sequence };
  }
}
