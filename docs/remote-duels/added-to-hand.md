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
  publicIdentity?: true; // explicit owner reveal overrides hidden Deck-add knowledge
};
// state.seats[seat].knownHand ?? []
```

This list is NOT the whole hand. It holds cards added by effects and cards
returned from the field to the hand. A face-up field card that stays absent
for 2 s, without arriving in a pile or another field zone, gets `source: 'field'` through the field-departure path.
A field-origin card is never a held card. A Set card that returns to hand has
no known-hand entry. The public log says `a Set card returned to hand`.
Draws, opening hands, cards seen in an ordinary hand fan, and a pile picked up for inspection do not populate the list.
An explicit `hand.reveal` can show one card already in hand. No other hand card
is inferred from that reveal.

All seats can read public `knownHand` entries and the `handCount` number.
With **Show cards added from Deck = off**, Deck-add entries stay owner-only.
Their identities are absent from public state, event payloads, log messages,
and undo snapshots. Search origins do not get an announced identity for these
adds. An explicit owner `hand.reveal` can publish a private entry; it sets
`publicIdentity:true`. A second reveal is then a no-op. Both counts
are optional until initialized. New tables initialize counts on `table.started`
from the starting hand size and registered deck; the event records `handCounts:1`
so historical replays keep their original initialization. Only the owner receives
`deckCount`. A movement also initializes missing counts for older tables.
Draw Phase entry adds the format's `drawPerTurn` to the turn seat. Standard
opening turn has no draw. Domain FFA uses `firstTurnDraw` (default on). The
rule normalizer accepts the table's seat count. Counts start before the first
turn change, so a later first play does not lose earlier draws.
An owner correction can also set `handCount`. No deck size is inferred without
a list. Public snapshots, replay, and undo snapshots preserve `handCount`.
An explicit `deck.count` measurement can establish a baseline without a list.
`deckCount` is approximate: only declared or observed movements change it.
Camera images do not provide a reliable physical pile count.

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
{type: 'hand.count', delta: 1} // or delta: -1
{type: 'hand.count', value: 5}
{type: 'hand.draw', count: 1} // owner action; count defaults to 1
{type: 'deck.count', value: 30} // owner observation; delta also accepted
{type: 'deck.count', delta: -2, cause: 'other'} // mill or another known cause
```

All hand actions and `deck.count` are in the strict `remoteActionSchema` and the exported
`RemoteAction` and `RemoteActionProposal` types. The UI needs no cast. The schema
rejects a `seat` field and unknown fields, including `hideAfterTurn`. The session
must own `actorSeat`; a solo host can also act for an owned bot seat.

`hand.count` accepts exactly one of `delta` or `value`. Both are integers.
`value` must be 0–999999; `delta` must be -999999–999999. A delta uses the current
count, or the room's starting hand size if no count exists. A result outside
0–999999 is an error. The action changes only the acting seat's public hand count.
It does not change known cards, physical twins, or the private deck count.
The normal owner checks, idempotency, undo, and replay apply.

`hand.add` increments the public hand count. Deck additions decrement the deck
count. GY, banish, and Extra additions move one matching twin to hand. GY/banish
use the same exit function as `pile.lift`. Field additions move the field twin.
A pile picked up for inspection keeps `inspectionFrom` on its hand twin.
It does not change hand counts on pickup or on return. `hand.add` from its
original pile confirms that the card went to the hand and counts it once.
A missing pile/field source is an error. `unknown` does not infer a source pile.

`hand.reveal` changes public knowledge only. It does not move a card or change
counts. A reveal of an already public known card is a no-op: no state change, event,
Undo entry, or toast. It preserves the last real Undo action. `hand.add` can add
separate physical copies. `hand.forget` removes one entry without changing counts.

A `twin.place` from hand consumes one matching known entry by `cardId`.
A different eligible search candidate does not consume the searched copy.
Extra Deck summons, catalog Extra Deck monsters, and tokens do not decrease
the hand count. Direct Deck or pile summons use their physical `fromRef`.
Deleting an unidentified face-up camera placeholder cancels its implicit play
and refunds the hand count. Deleting a Set or an identified field card does not.
New service events persist `handCountCorrections:1` for this replay behavior.
An anonymous Set decreases the count, but keeps possible known identities
private. When it turns face-up with a matching known hand twin, both the
entry and that hand twin are consumed. The count does not decrease again.
Discarding or returning that hand card to Deck also consumes one. A field move
or a direct pile-to-field move keeps an unrelated known hand copy. Undo restores
knowledge, counts, physical cards, and pile order through the current undo system.

The public log uses catalog names, for example:
`incursion_3 added Treasures of the Kings to hand (Man with the Mark's effect)`.
Forgetting a card does not remove an earlier public log line.
`hand.forget` logs `forgot a known card`; `hand.count` logs `set hand to N`.
Effect names come from catalog facts, including event projections.

`hand.draw` adds to the hand count and decreases an initialized private Deck
count. Voice accepts `draw`, `draw 2`, and `draw 2 cards`. A `deck.count`
decrease adds the difference to the hand count unless `cause:'other'` is set.
The first Deck measurement establishes a baseline when no count is known.
Phase draws and declared Deck movements already update that baseline; do not
report the same physical draw twice as separate actions.

A search add with `by` must match an unresolved origin's source, candidate,
and chosen identity, if set. A second add for a counted origin returns 409. Current
service events persist `handReview:1`; historical events retain their original
phase-draw semantics on replay.

## Search suggestions and voice

```ts
searchCandidates(state, seat, recentCardId, knowledge?) // RemoteSearchCandidate[]
// {cardId, name, source: 'deck' | 'gy' | 'banish', by: {cardId, name}, reason}
// RemoteEffectPlan.source: 'deck' | 'gy' | 'banish'
```

This helper is pure. Three arguments reuse server-resolved hand search origins
from `effect.activated`. For a field card that has not been activated, pass
`RemoteSearchKnowledge` (normalized catalog cards, effect tags, related map), or
use the read-only endpoint below. A plan's `source` is the physical origin of
the selected card. `by` identifies the effect card. Saved origins keep the pile
source in `searchSource`; old origins without that field use `deck`.
Pass the candidate's `source` unchanged to `hand.add`. A GY or banish add uses
the existing pile exit, moves one matching card, and leaves the Deck count unchanged.
The selected seat's deck list filters only `deck` results. Without a list, Deck
search origins use the catalog, and visible copies do not imply Deck exhaustion.
An explicitly empty registered list still filters out all Deck results. GY and banish results
must match a card in that seat's current pile, including a card lifted for
inspection. A related link ranks a supported search; it is not proof of an effect.
Printed clauses support quoted names, archetypes, simple types, and levels.
Named-card alternatives and Spell/Trap or monster clauses that `mention` that
name are separate alternatives. A mention matches the target's quoted card text,
not its catalog archetype. Printed alternatives can complete an indexed reading
that only retained the named card (for example, The Man with the Mark, `97522863`).
Engine facts supply card types and levels. Complex clauses remain suggestions.

`GET /api/remote/:slug/search?seat=0&recentCardId=123` returns `{candidates}`.
The service reads the engine/catalog and optional `data/vision/related-cards.json`.
Catalog inputs are cached for 60 s, up to 16 entries per database connection.
Keys include the catalog path, effect card, exact deck list, and pile identities.
Current state and the owner's list still filter each result. It does not write state, events,
or activity. Only the seat owner (or a solo host
for a bot seat) can query its private list. Do not broadcast the candidate list.

`parseRemoteHandCommand({text, actorSeat, candidates})` returns a proposal.
`add Temple of the Kings to hand` and `search Treasures` work when one candidate
matches. Ambiguous names or sources return `null`. The parser does not execute actions.
The normal shared command parser also accepts these forms after an activation.

## Held-card event: replaces the three-second capture

Import from `@yugidraft/vision`:

```ts
interface HeldCardTrack {
  id: string; state: 'held'; card: DetectedQuad; at: number; cardId?: string;
  visible?: boolean;
}
interface HeldCardEvent extends HeldCardTrack {
  type: 'held'; cardId: string; result: RecognitionResult; source: 'auto';
}
// FieldWatcherOptions.onHeldCard?: (event: HeldCardEvent) => void
// FieldSnapshot.held?: HeldCardTrack[]
// Also exported: createHeldCardReader(options), for other camera owners.
```

The owner watcher records outline provenance before it checks for a held card.
A card with a field origin is never held. This includes a card lifted to flip,
change position, move zones, become material, or enter a pile. Field history
wins over size and fingers. A recent field track within 2 s, in the same zone
or near the outline, also blocks held classification. Matching field texture
keeps that origin when the card moves away from its old zone. A missing
field outline also blocks a new held classification for 10 s when the face
can have changed during occlusion. This conservative check can require the
owner to confirm an addition while a recent field origin is unresolved.

A held candidate must enter from the player's near mat/frame edge, or first
appear outside all zones with no recent field track nearby. Fingers must touch
its edge. It must remain still for 200 ms. A hand fan does not start a read.
An oversized outline over a field zone is not held evidence.

The reader uses the next free recognition slot after those checks. It accepts
a sure front read once per episode, with at most two retries (three attempts).
After a held read, a waiting field read gets the next slot. A sure result from
the captured frame remains valid if the outline leaves view during the read.
`visible:false` marks the end of an observed episode. Detector misses retain
the episode briefly to avoid duplicate reads. Source frames stay local and
are released after recognition.

The camera adapter waits for the held episode to end, then waits 800 ms to
check for a play of the same identity. A fresh unfinished field read keeps
the decision pending for up to 5 s. If it is still unfinished, only a local
suggestion is allowed. A matching field twin or live field
read cancels the add. It calls:

```ts
remoteHandReadDecision(state, actorSeat, {cardId, id, at}, fieldReadPending);
// A matching unresolved search, at most 60 s old: hand.add with the candidate's source.
// An already known/returned card or field play: undefined.
// No search context: RemoteHandSuggestionEvent (local only).
```

A search origin has an owner-only `at` timestamp from activation. It must be
unresolved (`!handCounted`), match `searchCandidates`, and match its chosen
card if one exists. A held read never sends `hand.add source:'field'` or
`hand.reveal`. The independent field-departure path waits 2 s before a default
hand return. A field reappearance or pile arrival in that window cancels it.
Before the write, the ref, zone, and slot must still match the original field
card. A delayed removal cannot take a card out of a pile.
The queue stays free during both waits so field and pile reads can complete.

The camera must not send `hand.add` without movement context. It can add a card
automatically only for a matching pending search, or for a face-up field card
that left the field and reached no pile or other field zone within about 2 s.
Otherwise, show the local `Add X to hand?` chip. Do not write state or reveal
the card until the owner makes an explicit choice.

The UI receives a local browser event:

```ts
import {
  REMOTE_HAND_SUGGESTION_EVENT, // 'remote:hand-suggestion'
  type RemoteHandSuggestionEvent,
} from '@yugidraft/shared/remote';

type RemoteHandSuggestionEvent = {
  type:'hand.suggest'; actorSeat:number; cardId:number; id:string; at:number;
};
// CustomEvent detail also includes {slug:string, name:string}.
// Show only for this owner and table: "Add X to hand?".
// No POST occurs until the owner confirms a source or chooses Reveal.
```

`hand.suggest` is not a server action. The strict schema rejects it. Do not
broadcast, persist, or POST this event. Confirmation must retain the actual
source: `deck`, `gy`, `banish`, `extra`, `field`, or `unknown`.
`hand.add.by` contains only `cardId` and `name`; do not copy an effect source's
`cardRef` into this strict object. `searchCandidates` returns `deck`, `gy`, or `banish` from the matching plan;
the voice parser and held-card decision preserve that source.
The existing `remoteHandActionFromVision` helper remains available
for explicit owner choices; the automatic camera path uses the decision helper.

The event ID is the HTTP idempotency key on retries. Camera callbacks apply
only to the owner of the feed. The UI worker owns chip placement, dismissal,
source controls, and FX. Do not run the old capture timer with this path.

## Completion checks

Extend one existing shared remote reducer test; add no test file. Cover hand
scope, exits, public counts, owner-only count changes, strict schemas, deck
privacy, undo, replay, search/voice, and the held reader. Typecheck
shared, web, and vision with Node 22. Use WIP commits and push the core branch.
