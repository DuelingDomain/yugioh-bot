# Decks

A player keeps saved decks in a library, edits them in the deck editor, and takes them into duels and tournaments. Data flow: [architecture/data-flow.md](../architecture/data-flow.md).

## Entry points

| URL | What it is | Source (`packages/web/`) |
| --- | --- | --- |
| `/decks` | Deck library: list, "New deck", "Import decks" | `app/(app)/decks/page.tsx`, `src/components/decks/library.tsx` |
| `/decks/new` | Empty deck editor | `app/(app)/decks/new/page.tsx` |
| `/decks/[id]` | Edit a saved deck. `?room=<slug>` adds "Back to room" | `app/(app)/decks/[id]/page.tsx`, `src/components/decks/editor.tsx` |
| `/decks/draft/[slug]` | Build a deck from a finished draft pool | `app/(app)/decks/draft/[slug]/page.tsx`, `src/components/decks/draft-deck-editor.tsx` |

## Deck formats

A saved deck is a mode plus an optional Genesys tag (`src/components/decks/format-model.ts`).

| Format | Mode | Notes |
| --- | --- | --- |
| Standard | `normal` | Starts on the current TCG banlist |
| Domain | `domain` | Singleton deck with a Deck Master. No banlist |
| Genesys | `normal` + Genesys | Points replace the banlist. Link and Pendulum Monsters are not allowed |
| Genesys Domain | `domain` + Genesys | Same, on Domain |

The Genesys point cap is 0 to 1000; the default is 100. Contract: [api/genesys-contract.md](../api/genesys-contract.md). How the points list is synced: [architecture/card-data/genesys-points.md](../architecture/card-data/genesys-points.md).

## Build or edit a deck

1. The player opens `/decks/new` or a deck from the library.
2. The card browser searches the catalog (`POST /api/decks/cards`, filters from `GET /api/decks/cards/facets`). Card details come from `POST /api/duels/cards`.
3. The player drags cards into Main, Extra and Side. The editor checks section sizes and copy limits while the player works. Incomplete decks can be saved.
4. Save: `POST /api/decks` (new) or `PUT /api/decks/[id]`. Delete: `DELETE /api/decks/[id]`. The service is `createSavedDeckService` (`packages/shared/src/services/saved-decks.ts`). A player sees and edits only their own decks.
5. "Copy YDKE" puts a `ydke://` code on the clipboard. A Deck Master is not part of YDKE, so it is left out.

## Import

| Where | Input | Routes |
| --- | --- | --- |
| Editor import | One deck: YDK, `ydke://`, or a card-name list | `POST /api/decks/import` prepares the deck only. The normal save request stores it |
| Library "Import decks" | Many decks: files or pasted text, one row per deck | `POST /api/decks/import/preview`, then `POST /api/decks/import/bulk` |

Rules, in short:

- Name lists accept counts such as `3x Dark Hole`, `3 Dark Hole` and `Dark Hole x3`, and Main/Extra/Side headings.
- Extra Deck monsters listed in Main move to Extra. Explicit Side cards stay in Side.
- In Domain, a lone Side card becomes the Deck Master.
- Unknown names block their row and show the source line.

Full spec: [specs/deck-import-formats.md](../specs/deck-import-formats.md).

## Alternate artwork

1. On a card in the deck, the player opens the art menu. The editor calls `GET /api/cards/[passcode]/artworks` for the art family.
2. The player picks an art. `POST /api/decks/artwork` checks the swap on the working deck.
3. The normal deck save stores the chosen passcode.

Only passcodes in the engine's art alias family are allowed. Contract: [api/alt-art-picker.md](../api/alt-art-picker.md).

## Deck suggestions

The editor can show card suggestions and archetype guides. It calls `POST /api/cards/insights` (ops such as `suggestRows`, `guide`, `summary`; client in `src/components/decks/insights-api.ts`). It needs `EFFECT_SEARCH=1` and `DECK_SUGGESTIONS=1` on web and the duel server. Both are off by default. Contract: [api/deck-suggestions-contract.md](../api/deck-suggestions-contract.md).

## Test duel

1. In the editor, the player opens "Test duel". The page calls `GET /api/duels/test` to warm up an engine thread.
2. The player picks shuffle (random hand) or deck order (first 5 Main Deck cards are the hand), and who goes first.
3. Start: `POST /api/duels/test` with `{ mode, deck, genesys?, shuffle?, goFirst? }`. The duel server starts a private, unranked duel against the practice bot and returns `{ slug }`.
4. The page opens `/duels/[slug]`. The result never counts.

Source: `app/api/duels/test/route.ts`.

## Decks in a duel room

In a duel lobby, the deck picker lists saved decks for that room (`GET /api/decks?room=<slug>`) and sends the choice with `POST /api/duels/[slug]/deck` (`/deck/validate` checks it first). "Edit" opens `/decks/[id]?room=<slug>`; the way back leads to the room. See [duels-and-tables.md](duels-and-tables.md).

## Draft decks

After a draft, `/decks/draft/[slug]` loads the player's pool from `GET /api/drafts/[slug]/deck-pool`. The deck can use only pool cards. The save uses the normal deck routes. A draft tournament registers these saved draft decks. See [cubes-and-drafts.md](cubes-and-drafts.md).
