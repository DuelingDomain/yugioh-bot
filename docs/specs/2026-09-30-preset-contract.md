# Preset contract (duel host and web)

Status: live contract (`packages/duel-server/src/host.ts`, `src/presets/`).

A preset is a hand scenario. The user plays seat 0 in the web room. Scripted bots play the other seats. The host
ops below are on the same endpoint as all other duel ops: `POST /internal/duel`, signed body, same auth. They only work
when the duel host runs with env `DUEL_SCENARIOS=1`. Without it the host answers HTTP 404
`{ "error": "Not found" }` for these three ops.

Every body has `guildId` and `playerId` (the web player id, as for all ops).

## Op `list-presets`

Request: `{ op: "list-presets", guildId, playerId }`

Response:

```json
{ "presets": [
  { "id": "dust-tornado-chain", "title": "...", "format": "1v1", "humanSeat": 0, "seats": 2,
    "checklist": ["..."], "needsMultiCore": false, "needs": null, "rules": ["R-..."],
    "available": true, "unavailableReason": null,
    "issues": [{ "sig": "...", "title": "...", "owner": "..." }] }
],
  "core": { "tag": "...", "sha": "..." } }
```

`core` is the multi core of the data directory (`multiCoreInfo`; both fields are `null` when it is missing).

- `needsMultiCore` (boolean) and `needs` (`null` or `"multi-core"`) say the same thing.
- `rules` = ADR-0002 rule ids the preset covers.
- `available` is `false` when the preset needs the multi-duelist core and the engine data directory has no
  `ocgcore.multi.wasm`. Then `unavailableReason` holds the text to show. The web must not start an unavailable preset
  (the host also refuses it with HTTP 409).
- `issues` lists known problems for the preset (empty when none).
- `checklist` is the list of things the tester must see, in order. Show it in the room (a side panel).

## Op `start-preset`

Request: `{ op: "start-preset", presetId, guildId, playerId }`. Optional `seed` (array of 4 decimal strings) for tests.
The field name is `playerId`, not `humanUserId`, like every other op.

Effect: the host creates a table (name = preset title, private, the human in seat 0 as organizer), fills every other
seat with a scripted bot, stores the preset in the duel setup and starts the duel. The human has the first prompt
(or waits for the bots when a bot has it).

Response (HTTP 200): `{ "slug": "...", "session": DuelSession, "room": DuelRoom }`. `room` is the projection for the
caller, the same as op `view`.

Errors: 404 unknown preset id or gate off, 409 preset needs the multi-core and it is missing, 400 bad body.

## Op `report`

Request: `{ op: "report", slug, note, guildId, playerId }`. `note` is text of at most 4000 characters.

Effect: writes the folder `<repo>/.status/manual/<slug>-<iso-time>/` with

- `journal.jsonl`: first line = `{ "type": "duel", slug, presetId, format, mode, seed, bundleVersion, status }`, then one
  line per accepted answer `{ "type": "answer", seq, seat, bot, note?, command }`. A scripted bot line has `bot: true`
  and `note` = the reason of the rule that fired (or `"default: pass"` when no rule matched).
- `views/seat-<n>.json` for every seat (the engine view that seat sees, prompt included).
- `timeline.md` only when a timeline helper can be imported (today: not written).
- `note.md`: the tester's note, the checklist and the slug.

Response: `{ "path": "<absolute folder>" }`. The folder is relative to the repo root that holds the engine data
directory (override with env `DUEL_REPORT_DIR`). `.status/manual/` is ignored by git (`.gitignore`, `.status/`) and by Docker (`.dockerignore`).

## Journal note field

Each stored answer (`duel_commands.command_json`) of a scripted bot carries one extra field: `note` (string).
Other readers must ignore it. Replay only uses `promptId`, `revision` and `answer`.

## Surrender by a bot

The rule helper `surrender()` makes the host call the same path as op `surrender` for that seat (FFA: the seat is out;
Tag: the team loses; 1v1: the other seat wins). It is NOT stored as an answer. In FFA the host records the seat in
`setup_json.surrenderedSeats`. In `journal.jsonl` of a report it shows as a separate line `{ "type": "surrender", seat }`
after the answers.

## Setup JSON stored in the duel (`duels.setup_json`)

`{ scenarioId?, presetId, startupScripts: string[], botPolicies: { "<seat>": "scripted" }, surrenderedSeats? }`.
`scenarioId` is set to the preset id too. Recover and replay rebuild the same board from `startupScripts`. The bot
rules are not stored (they are code): they come from the preset registry by `presetId`. Rules are stateless
functions of (prompt, view), so a recover after a restart plays the same.

## Preset ids

Call `list-presets` for the current ids (source: `packages/duel-server/src/presets/`). Do not hard-code ids in the web.
