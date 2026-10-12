# Domain first-turn draw

Domain Format rulebook v1.4 says each player draws on their first turn,
except the first player in a two-player duel.

## Real-engine verification (2026-10-11)

On unmodified host code at `bc8a421ae`, Domain FFA3 and FFA4 both give the
first player six cards after turn 1's Draw Phase: five opening cards plus
one turn draw, leaving 34 of the 40 Main Deck cards. Other players still
have five cards. Each Deck Master is created separately in the Deck Master
Zone and does not reduce the opening hand. Both legacy and pinned Domain
1v1 engines leave the first player's hand at five and deck at 35.

The focused real-engine assertions are in
`packages/duel-server/tests/engine-domain-first-turn-draw.test.ts`. They
check turn 1, the first player, completion of the Draw Phase, hand/deck
counts, Deck Master placement, and the separate turn draw event.

These assertions passed on the installed P98 Domain multi core (SHA256
`51e41ea7e8620b46fbdb5685341d2b20eae224bfb0870aec6fea52c09d15cac4`)
and a fresh build of this branch's full patch series (SHA256
`4c4dccb31589893eedcc1a21f75d4fa3c5b6863a1d875f5d062604a1315db383`,
matching `domain-core/expected-sha256.txt`). No draw bug was reproduced and
no core change is needed.

Patch 0015's note that the first-turn draw check was unchanged does not
mean the core always skips the draw. The Turn processor draws when
`is_flag(DUEL_1ST_TURN_DRAW) || infos.turn_id > 1`. The host's
`OcgDuelMode.FIRST_TURN_DRAW` sets that same flag. This check has no
multiplayer exception.

Run from `packages/duel-server`, with built shared and installed cores:

```sh
DUEL_REQUIRE_CORES=1 npx vitest run tests/engine-domain-first-turn-draw.test.ts --testTimeout=30000
```

## Per-duel setting

`POST /api/duels` accepts `settings.firstTurnDraw` as a boolean for
`mode: "domain"` with `format: "ffa3"` or `"ffa4"`. Omission defaults to
`true`. Setting it to `false` skips only the first player's turn-1 draw;
everyone else's first-turn draw and subsequent draws stay unchanged.
Turning it off marks the table as Custom Domain.

```json
{ "name": "Domain table", "mode": "domain", "format": "ffa3", "settings": { "firstTurnDraw": false } }
```

Domain 1v1, Tag and Standard have no such setting; requests supplying it
for these modes/formats receive 400. Their draw rules stay unchanged.

The shared `@yugidraft/shared/duels` exports `DuelSettings.firstTurnDraw`,
`DOMAIN_FFA_FIRST_TURN_DRAW_SETTING` (`"firstTurnDraw"`),
`DOMAIN_FFA_FIRST_TURN_DRAW_DEFAULT` (`true`),
`supportsFirstTurnDrawSetting(mode, format)` and format-aware
`defaultDuelSettings(mode, format)` for the separate UI implementation.

Each new duel saves the resolved flag as `setup.firstTurnDraw`. Recovery,
browser replay and journal replay keep using that saved flag, even if it
conflicts with the table settings. Old records retain the existing
`savedFirstTurnDraw` fallback, including refusal to guess ambiguous old
FFA rules. Stored settings without the new field remain unspecified.
