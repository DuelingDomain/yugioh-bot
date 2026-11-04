# Added to hand: shared, vision, and UI contract

Core branch: `feat/remote-reveal`. UI branch: `feat/remote-reveal-ui`.

## Scope and state

Import shared types and helpers from `@yugidraft/shared/remote`.
Each seat has public hand knowledge:

```ts
type RemoteKnownHandCard = {
  id: string; // action idempotency key; one entry per physical copy
  cardId: number;
  source: 'deck' | 'gy' | 'banish' | 'extra' | 'field' | 'unknown';
  by?: {cardId: number; name: string};
  at: number;
  revealed: true;
};
// state.seats[seat].knownHand ?? []
```

This list is NOT the whole hand. It holds cards added by effects and cards
returned from the field to the hand. A field card that vanishes to the default
hand destination gets `source: 'field'`. Draws, opening hands, cards seen in an
ordinary hand fan, and a pile picked up for inspection do not populate the list.
An explicit `hand.reveal` can show one card already in hand. No other hand card
is inferred from that reveal.

All seats can read `knownHand`. Private `handCount` and `deckCount` are optional.
Only the owner receives them. A movement initializes missing counts from the
starting hand size and registered deck. No deck size is inferred without a list.

`room.revealedHand` and `state.revealedHand` are `'until-played' | 'one-turn'`.
Default: `'until-played'`. Table create and lobby format requests accept this
rule. The rule is stored in state JSON and system events; no migration is needed.
Only `'one-turn'` clears the list at the end of the adding seat's turn. An entry
added on another seat's turn stays until its owner's turn ends. There is no
per-entry turn override. The rule persists across match games.

## Actions and undo

Use `POST /api/remote/:slug/actions` with `baseSeq`, `actorSeat`, and a fresh
`idempotencyKey`. The server supplies `at`. The actor owns the hand; omit `seat`.

```ts
{type: 'hand.add', cardId, source, by?: {cardId, name}}
{type: 'hand.reveal', cardId}
{type: 'hand.forget', id}
```

`hand.add` increments the private hand count. Deck additions decrement the deck
count. GY, banish, and Extra additions move one matching twin to hand. GY/banish
use the same exit function as `pile.lift`. Field additions move the field twin.
A missing pile/field source is an error. `unknown` does not infer a source pile.

`hand.reveal` changes public knowledge only. It does not move a card or change
counts. Repeated reveals of a known card do not add copies. `hand.add` can add
separate physical copies. `hand.forget` removes one entry without changing counts.

A `twin.place` from hand consumes one matching known entry by `cardId`.
Discarding or returning that hand card to Deck also consumes one. A field move
or a direct pile-to-field move keeps an unrelated known hand copy. Undo restores
knowledge, counts, physical cards, and pile order through the current undo system.

The public log uses catalog names, for example:
`incursion_3 added Treasures of the Kings to hand (Man with the Mark's effect)`.
Forgetting a card does not remove an earlier public log line.

## Search suggestions and voice

```ts
searchCandidates(state, seat, recentCardId, knowledge?) // RemoteSearchCandidate[]
// {cardId, name, source: 'deck', by: {cardId, name}, reason}
```

This helper is pure. Three arguments reuse server-resolved hand search origins
from `effect.activated`. For a field card that has not been activated, pass
`RemoteSearchKnowledge` (normalized catalog cards, effect tags, related map), or
use the read-only endpoint below. Only the selected seat's deck list filters
results. A related link ranks a supported search; it is not proof of an effect.
Printed clauses support quoted names, archetypes, simple types, and levels.
Engine facts supply card types and levels. Complex clauses remain suggestions.

`GET /api/remote/:slug/search?seat=0&recentCardId=123` returns `{candidates}`.
The service reads the engine/catalog and optional `data/vision/related-cards.json`.
It does not write state, events, or activity. Only the seat owner (or a solo host
for a bot seat) can query its private list. Do not broadcast the candidate list.

`parseRemoteHandCommand({text, actorSeat, candidates})` returns a proposal.
`add Temple of the Kings to hand` and `search Treasures` work when one candidate
matches. Ambiguous names return `null`. The parser does not execute actions.
The normal shared command parser also accepts these forms after an activation.

## Held-card event: replaces the three-second capture

Import from `@yugidraft/vision`:

```ts
interface HeldCardTrack {
  id: string; state: 'held'; card: DetectedQuad; at: number; cardId?: string;
}
interface HeldCardEvent extends HeldCardTrack {
  type: 'held'; cardId: string; result: RecognitionResult; source: 'auto';
}
// FieldWatcherOptions.onHeldCard?: (event: HeldCardEvent) => void
// FieldSnapshot.held?: HeldCardTrack[]
// Also exported: createHeldCardReader(options), for other camera owners.
```

The owner watcher detects an outline outside the field cells, or larger than a
flat cell after mat rectification, with skin touching the edge or next to it.
The raised-card check is a conservative size heuristic, not a depth sensor.
A hand fan with more than one held outline does not trigger reads.
The separate held reader gets the next free recognition slot before field reads.
It has no stillness timer and no three-second hold. It emits on the first sure
front read, once per continuous held-card episode. Unsure reads can retry.
A held outline never enters the field-placement path. A short lost-outline
window keeps detector misses from producing duplicate events; it does not delay
the first read. Frames stay local and are released after recognition.

The web owner callback converts the event to a hand action. It uses a recent
search origin for `source: 'deck'`, a field departure for `source: 'field'`, and
`'unknown'` otherwise. Without a movement source it reveals the card and leaves
counts unchanged. An already known or already returned card also uses reveal mode
to avoid adding it twice. The event ID is the HTTP idempotency key on retries.

```ts
type RemoteHandVisionEvent = {
  cardId: number;
  mode: 'add' | 'reveal';
  source?: RemoteKnownHandCard['source'];
  by?: {cardId: number; name: string};
};
remoteHandActionFromVision(event, actorSeat); // RemoteActionProposal
```

The UI worker can use `onHeldCard` and remove its old capture timer. Do not run
both capture paths. Camera callbacks apply only to the owner of the feed.

## Completion checks

Extend one existing shared remote reducer test; add no test file. Cover hand
scope, exits, privacy, undo, replay, search/voice, and the held reader. Typecheck
shared, web, and vision with Node 22. Use WIP commits and push the core branch.
