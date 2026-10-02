/** Display identities are independent of the core's mutable hand sequences. */
type Entry = { id: string; code: number; arrival?: number; ordinal: number };
export type HandEntry = Entry & { sequence: number };

export class HandOrder {
  private next = 0;
  private own: Entry[][] = [[], []];
  private sleeves: Entry[][] = [[], []];

  add(seat: number, code: number, sequence: number, arrival?: number): void {
    const ordinal = ++this.next;
    this.own[seat]!.splice(sequence, 0, { id: `hand-${ordinal}`, code, arrival, ordinal });
    this.sleeves[seat]!.splice(sequence, 0, { id: `sleeve-${ordinal}`, code: 0, arrival, ordinal });
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
    // Duplicate copies are interchangeable to the core; use their previous engine order to match them.
    const available = [...this.own[seat]!];
    this.own[seat] = codes.map((code) => {
      const index = available.findIndex((entry) => entry.code === code);
      if (index < 0) throw new Error("Hand shuffle does not match tracked cards");
      return available.splice(index, 1)[0]!;
    });
    // Never follow a hidden card through the shuffle. Rebind anonymous sleeves by display slot.
    this.sleeves[seat]!.sort((a, b) => a.ordinal - b.ordinal);
  }

  entries(seat: number, owner: boolean): HandEntry[] {
    return (owner ? this.own : this.sleeves)[seat]!
      .map((entry, sequence) => ({ ...entry, sequence }))
      .sort((a, b) => a.ordinal - b.ordinal);
  }
}
