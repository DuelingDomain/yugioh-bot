# Deck Suggestions API

The deck editor uses the client functions in
`packages/web/src/components/decks/insights-api.ts`.

## Capability

Set `EFFECT_SEARCH=1` and `DECK_SUGGESTIONS=1` on the web server and engine host.
`DECK_SUGGESTIONS` is off by default in all environments.
Do not use a public environment variable.
Compose forwards both flags to both services.

The app layout supplies the capability. Read `useDeckSuggestionsEnabled()`
from `components/effect-search/capability-context`. Insight responses also
include `deckSuggestionsEnabled`. The server checks both flags on each request.

## Get all rows

Use `fetchSuggestRows(deck, scope, signal)`, or send:

```http
POST /api/cards/insights
Content-Type: application/json
```

```json
{
  "op": "suggestRows",
  "deck": { "main": [89631139], "extra": [], "side": [] },
  "format": "normal",
  "banlist": "tcg-2026-09",
  "exclude": []
}
```

Pass each physical card copy in its section. The deck must have all three
sections. `deck.deckMaster` and the top-level `deckMaster` are optional
passcodes. Use the same master in both places. The top-level value takes
precedence. The request permits at most 100 cards across Main, Extra and Side.
The host permits one in-flight suggestion request per player and two globally.
Excess requests return HTTP 429 and can be retried after the active request completes.

Optional fields:

| Field | Meaning |
| --- | --- |
| `format` | `normal`, `domain`, `genesys`, or `genesys-domain`; default `normal` |
| `banlist` | A versioned ID from the deck editor; unknown IDs return 400 |
| `deckMaster` | The selected Domain Deck Master |
| `pool` | Draft pool multiset, at most 5,000 passcodes; repeat IDs for copies. `[]` returns empty rows |
| `exclude` | Additional cards to hide, at most 5,000 passcodes |
| `genesysRemaining` | Additional upper bound on remaining points; the server also checks the deck's 100-point budget |
| `released` | Existing effect-search release range |

Standard defaults to the pinned TCG ban list. Domain and Genesys use the
deck validator's format defaults. Domain without a master returns no candidate
cards. An unknown, blocked or invalid master returns 400. Each response is
scoped to the submitted deck and pool.

```json
{
  "effectSearchEnabled": true,
  "deckSuggestionsEnabled": true,
  "version": "suggestions-1:...",
  "rows": [
    { "id": "archetype", "state": "ready", "cards": [] },
    { "id": "outside", "state": "ready", "cards": [] },
    {
      "id": "extra",
      "state": "hint",
      "hint": "Add 40 Main Deck cards.",
      "minimumMainCards": 40,
      "mainCards": 1,
      "cards": []
    },
    { "id": "staples", "state": "ready", "cards": [] }
  ]
}
```

Show these labels in this order:

1. Archetype support
2. Outside the archetype
3. Extra Deck you can make
4. Staples for this format

Each row has at most 12 cards. Staples has at most 6 and at most 25% of all
shown cards. Each card can occur in one row only. A card already in any deck
section is omitted. The server also checks copy identity, ban list limits,
Domain admission, engine availability, pool copies, and Genesys points.

Each card is a `RankedInsightCard`:

```json
{
  "passcode": 6853254,
  "name": "Return of the Dragon Lords",
  "score": 5,
  "linkedCards": 1,
  "reason": "Supports your Dragon monsters"
}
```

`reason` is one line. `release` and `deckMasterFit` can also be present.
Use `resolveInsightCards(ranked, { mode }, signal)` for display metadata.
Preserve server order. Do not compare scores between rows.

The Extra row has `state: "hint"` below 40 Main Deck cards. At 40 or more,
it has `state: "ready"`, even if no summon can be proved. The proof uses
distinct Main Deck copies and complete printed material requirements.
Unknown requirements fail closed. Side, Extra and Deck Master cards do not
supply materials. Token and multi-step summon chains are not inferred.

## Outside-archetype text

Use `fetchOutsideSuggestions(text, deck, scope, signal)`. It sends
`op: "effectSearch"` with the same deck, format and scope. These phrases
select the Outside row:

```text
outside Blue-Eyes
non Blue-Eyes cards that synergize with Blue-Eyes
```

The response uses the existing effect-search shape: `reading`, `cards`,
`total`, and the capability fields. Its reading has
`query.intent: { kind: "outside", archetype: "Blue-Eyes" }`.
With the same deck and scope, the card list is the Outside row list.
This path does not call runtime AI. If no deck is supplied, the backend
derives an archetype context from known Main Deck members.

## UI request control and errors

When the search is empty, wait 600 ms after the last deck change, then
request all rows. Abort the old request on any deck or scope change.
Show rows only for the current request. Show the Extra hint as returned.
When the player types, use normal search or the outside-text helper.

Successful data responses use `Cache-Control: private, no-store`. A server cache stores at
most 64 deck results per database. Its key includes section copies, format,
master, pool copies, exclusions, release range, points, ban list, admission
version and catalog data version. The web server stores only completed results.
The engine host runs the catalog scan and checks current capabilities, actor
access, admission and data versions on every request. It confirms the cached
version before the web server can reuse a result. It does not keep a second
result cache. An engine failure does not permit a cached response.

Errors: 400 invalid input; 401 no session; 403 no community player;
404 capability off (`deck_suggestions_disabled` or `effect_search_disabled`);
502 invalid engine response; 503 unavailable identity, community or engine.
An engine failure must not produce a permissive suggestion list.

The row UI is a separate task. This branch supplies the backend, client
functions and capability only.
