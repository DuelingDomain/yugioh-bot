# Added to hand: shared and UI contract

Branch: `feat/remote-reveal`. UI branch: `feat/remote-reveal-ui`.

## State and room rule

Import shared types and helpers from `@yugidraft/shared/remote`.
Each `state.seats[seat].knownHand` is a public array:

```ts
type RemoteKnownHandCard = {
  id: string; // action idempotency key; one entry per physical copy
  cardId: number;
  source: 'deck' | 'gy' | 'banish' | 'extra' | 'unknown';
  by?: { cardId: number; name: string };
  at: number;
  revealed: true;
  hideAfterTurn?: boolean;
};
```

Old snapshots can omit the array. Read it as `seat.knownHand ?? []`.
The private `handCount` and `deckCount` fields are optional. The owner receives
them. Other seats do not. The first hand action initializes missing counts from
the registered deck and the room's starting hand size. No deck list is inferred
when no list is registered.

`room.revealedHand` and `state.revealedHand` are `'until-played' | 'one-turn'`.
The default is `'until-played'`. Table create and lobby format requests accept
`revealedHand`. The rule is stored in state JSON and in system events.
There is no database migration.

## Actions

Use the normal `POST /api/remote/:slug/actions` envelope with `baseSeq`,
`actorSeat`, and a fresh `idempotencyKey`. The server supplies `at`.
The actor owns the affected hand. Do not send a `seat` field.

```ts
{ type: 'hand.add', cardId, source: 'deck', by?: { cardId, name }, hideAfterTurn?: boolean }
{ type: 'hand.reveal', cardId, hideAfterTurn?: boolean }
{ type: 'hand.forget', id }
```

`hand.add` increments the private hand count. Deck additions decrement the
private deck count. GY/banish/extra additions move one matching twin to the hand.
GY and banish use the same exit code as `pile.lift`. A missing source card is an
error. `unknown` does not change a source count or infer a pile.

`hand.reveal` adds public knowledge. It does not change counts or move a card.
Repeated reveals of an already known card do not create more copies.
`hand.add` can add separate copies of the same card. `hand.forget` hides one
entry without moving the physical card or changing counts.

The optional `hideAfterTurn` overrides the room default for that entry.
At the end of the owner's turn, entries with this flag clear. Entries added
during another player's turn stay until the owner's next turn ends.
The default entries stay visible until they leave the hand.

A `twin.place` that takes a matching card from hand consumes one known entry.
A move or removal from hand also consumes one. A field-to-field move or a direct
pile-to-field move does not consume an unrelated known copy. Returning to Deck
increments its count. Undo restores knowledge, counts, and pile order.

The public log uses catalog names, for example:
`incursion_3 added Treasures of the Kings to hand (Man with the Mark's effect)`.
Hiding an entry does not erase earlier public log events.

## Search suggestions

```ts
searchCandidates(state, seat, recentCardId, knowledge?) // RemoteSearchCandidate[]
// { cardId, name, source, by: { cardId, name }, reason }
```

The helper is pure. Its three-argument form reads the seat's resolved effect
plans. The optional `RemoteSearchKnowledge` supplies catalog cards, engine type
and level facts, and the existing related-cards map for local UI callers.
The helper filters candidates through the seat's registered Main/Extra Deck
or public GY/banish pile for the matching source. It never uses another seat's
private deck. The related map supplies candidates; printed search clauses or
resolved effect plans must also support them. A related card alone is not proof
of a search effect. Complex clauses remain suggestions, not rule enforcement.

`GET /api/remote/:slug/search?seat=0&recentCardId=123` returns `{ candidates }`.
The server reads engine/catalog facts and the optional prepared
`data/vision/related-cards.json`. This endpoint has no writes or event updates.
Only the owner (or the solo host for a bot seat) can query a seat's private list.

Voice grammar can use the returned list through
`parseRemoteHandCommand({ text, actorSeat, candidates })`.
`add Temple of the Kings to hand` and `search Treasures` return a `hand.add`
proposal only when one candidate matches. No action is executed by the parser.

## Camera hook

Exported `RemoteHandVisionEvent` uses `{ cardId, mode: 'add' | 'reveal' }`.
`remoteHandActionFromVision(event, actorSeat)` returns an action proposal.
Add mode uses `source: 'unknown'`; reveal mode does not move the card.
The UI owns the Reveal area and scan debounce. Reuse the same action key for a
retry of one scan. Use reveal mode for a card that is already in the hand.

## Work and checks

1. Extend one existing shared remote test with reducer, privacy, service replay,
   helper, voice, and camera assertions. Add no test file.
2. Add hand schemas and state. Reuse pile exits. Track hand departures and turn expiry.
3. Add room settings, public log messages, and read-only search data resolution.
4. Build and typecheck shared. Typecheck web. Run the one shared test file.
5. Push WIP commits. Report the commit IDs and this path.
