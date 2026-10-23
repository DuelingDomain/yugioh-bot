import type { DuelCard, DuelCardHint, DuelEngineView, DuelProtectionCategory } from "@yugidraft/shared/duels";
import { isFacedown } from "../../constants";
import type { TableFixtureSet } from "./common";

/** A hint in the engine's wire shape; ids only need to differ inside one card. */
function hint(id: number, text: string, ...categories: DuelProtectionCategory[]): DuelCardHint {
  return { descriptionId: String(1_000_000 + id), text, categories };
}

/** The Dracombatant case: three immunities, one hint with two categories, and a plain status line. */
const DRACOMBATANT: DuelCardHint[] = [
  hint(1, "Unaffected by Spell effects", "unaffected-spells"),
  hint(2, "Unaffected by your opponent's Trap effects", "unaffected-traps"),
  hint(3, "Cannot be destroyed by battle or card effects", "cannot-be-destroyed-by-battle", "cannot-be-destroyed-by-effects"),
  hint(4, "Cannot be targeted by your opponent's card effects", "cannot-be-targeted"),
  hint(5, "Your opponent cannot attack other monsters", "cannot-be-attacked"),
  hint(6, "Cannot attack this turn", "status"),
];

/** One decoration per occupied Monster Zone, in order: every seat shows the same mix. */
const DECORATIONS: ReadonlyArray<(card: DuelCard) => DuelCard> = [
  // Many protections: the rail must fold ("+N") on a small card.
  (card) => ({ ...card, hints: DRACOMBATANT }),
  // A primary counter, a generic family counter, a card-specific one and an unknown id (a legacy board): the stack folds past 3 types.
  (card) => ({ ...card, counters: [{ type: 0x1, count: 3 }, { type: 0x1b, count: 2 }, { type: 0x7, count: 1 }, { type: 0x7fff, count: 12 }] }),
  // Negated, with a protection and a counter so the rail and the stack share the card.
  (card) => ({ ...card, negated: true, hints: [hint(7, "Unaffected by Monster effects", "unaffected-monsters")], counters: [{ type: 0x100e, count: 120 }] }),
  // Current stats differ from the printed ones, with one protection.
  (card) => ({ ...card, baseAttack: (card.attack ?? 0) + 700, baseDefense: Math.max(0, (card.defense ?? 0) - 300), hints: [hint(8, "Cannot be destroyed by battle", "cannot-be-destroyed-by-battle")], counters: [{ type: 0x1009, count: 1 }] }),
  (card) => ({ ...card, hints: [hint(9, "Unaffected by other cards' effects", "unaffected-effects")] }),
];

/** The same engine view with the face-up monsters of every seat decorated (see DECORATIONS). */
export function withCardStatusEngine(engine: DuelEngineView): DuelEngineView {
  const seats = engine.seats.map((view) => {
    let next = 0;
    const monsters = view.monsters.map((card) => {
      if (!card || card.code == null || isFacedown(card.position)) return card;
      const decorateCard = DECORATIONS[next % DECORATIONS.length];
      next += 1;
      return decorateCard(card);
    });
    return { ...view, monsters };
  });
  return { ...engine, seats };
}

/**
 * `?status=1` on a table preview: the face-up monsters of every seat carry protections, counters, a negated mark
 * and base stats, so the badges can be checked on each mode, seat angle and size.
 */
export function withCardStatus(set: TableFixtureSet): TableFixtureSet {
  type State = TableFixtureSet["states"][keyof TableFixtureSet["states"]];
  const decorate = (state: State): State => (state.room.engine ? { ...state, room: { ...state.room, engine: withCardStatusEngine(state.room.engine) } } : state);
  const states = Object.fromEntries(Object.entries(set.states).map(([id, state]) => [id, decorate(state)])) as unknown as TableFixtureSet["states"];
  const extra = set.extra ? Object.fromEntries(Object.entries(set.extra).map(([id, state]) => [id, decorate(state)])) : undefined;
  return { ...set, states, extra };
}
